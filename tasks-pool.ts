
import { EventEmitter } from "events";
import assert from "assert";

type LoggerType = Pick<typeof console, 'debug' | 'error'>;

export class TasksPool {
    private pendingTasks = 0;
    private readonly logger: LoggerType;
    private readonly eventEmitter = new EventEmitter();

    constructor(logger?: LoggerType) {
        this.logger = logger || console;
    }

    /**
     * @returns The number of pending tasks
     */
    getPendingTasks() {
        return this.pendingTasks;
    }

    /**
     * Logs at the specified interval the number of remaining tasks in the pool
     * @returns A value to pass to `clearInterval` to stop the logging
     */
    pollAndLogPendingTasks(pollInterval = 1000): NodeJS.Timeout {
        const logPendingTasks = () => {
            this.logger.debug(`Pending tasks: ${this.pendingTasks}`);
        };

        return setInterval(logPendingTasks, pollInterval);
    }

    /**
     * Add a task in the pool, in the form of a promise without results.
     */
    addTask(task: Promise<void>): void {
        this.pendingTasks++;
        task.finally(() => {
            this.eventEmitter.emit("complete", --this.pendingTasks);
        }).catch(this.logger.error.bind(this));
    }

    /**
     * Wait for at least one pending task completion.
     * If there are no pending tasks in the pool, the returned promise wait for at least one task to be added.
     *
     * @returns Promise<number> A promise with the count of remaining tasks
     */
    async waitSomePendingTasks(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            try {
                const eventHandler = (count: number) => {
                    this.eventEmitter.off("complete", eventHandler);
                    resolve(count);
                };

                this.eventEmitter.on("complete", eventHandler);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Wait until the remaining tasks count is at most a certain value.
     * If there are no pending tasks in the pool, the returned promise wait for at least one task to be added.
     *
     * @param atMost The limit of tasks count to respect
     * @returns Promise<number> A promise with the count of remaining tasks
     */
    async waitAtMostPendingTasks(atMost: number) {
        assert(atMost >= 0, "atMost must be >= 0");

        if (this.pendingTasks <= atMost) return Promise.resolve(this.pendingTasks);

        return new Promise<number>((resolve, reject) => {
            try {
                const eventHandler = (count: number) => {
                    if (count <= atMost) {
                        this.eventEmitter.off("complete", eventHandler);
                        resolve(count);
                    }
                };

                this.eventEmitter.on("complete", eventHandler);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Create tasks from the callbacks in `taskGenerators()` ensuring that al least `parallelization` tasks are in execution at any time.
     * This method is asynchronous and terminates when all work has been inserted in the pool. Keep attention: this method doesn't terminate when all work submitted has been completed, to accomplish that call `waitAtMostPendingTasks(0)`
     * @param taskGenerators Array of callbacks used to generate the tasks
     * @param parallelization The maximum number of tasks that can be in execution at any time
     * @returns A Promise that terminates when data has entered the pool
     */
    async doTasksWithMaxParallelization(taskGenerators: (() => Promise<void>)[], parallelization: number): Promise<void> {
        assert(Number.isInteger(parallelization) && parallelization >= 1, "parallelization must be >= 1 and integer");

        if (taskGenerators.length === 0) return;

        for (let i = 0; i < taskGenerators.length; i++) {
            //Wait for a place in the pool to be empty
            await this.waitAtMostPendingTasks(parallelization - 1);

            this.addTask(taskGenerators[i]());
        }
    }

    /**
     * Call `generateTask()` on every element of `data`, ensuring that al least `parallelization` tasks are in execution at any time.
     * This method is asynchronous and terminates when all work has been inserted in the pool. Keep attention: this method doesn't terminate when all work submitted has been completed, to accomplish that call `waitAtMostPendingTasks(0)`
     * @param data Array of data used as input data
     * @param generateTask The callback used to generate the tasks
     * @param parallelization The maximum number of tasks that can be in execution at any time
     * @returns A Promise that terminates when data has entered the pool
     */
    async generateTasksWithMaxParallelization<T>(data: T[], generateTask: (d: T) => Promise<void>, parallelization: number): Promise<void> {
        return this.doTasksWithMaxParallelization(data.map(t => () => generateTask(t)), parallelization)
    }
}
