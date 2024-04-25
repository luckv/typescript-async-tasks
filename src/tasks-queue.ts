import {EventEmitter} from "events";
import assert from "assert";

type LoggerType = Pick<typeof console, 'debug' | 'error'>;

export type RetryPolicy = {
    /**
     * Number of milliseconds for the first back off time. Must be greater than 0.
     * At every run, the last backoff time of the task is doubled
     */
    readonly minBackOffTime?: number;
    /**
     * A callback that decide if a task should be retried after an error
     * @param tries Number of tries already done
     * @param error The error occured
     */
    readonly shouldRetry: (tries: number, error: any) => boolean;
};
type RetryState = { retries: number; lastBackoffTime?: number; notBefore?: number };
type TaskDescriptor<T> = {
    readonly taskCreator: () => Promise<T>;
    readonly counter: number;
    readonly promiseCbs: {
        readonly resolve: (value: T | PromiseLike<T>) => void;
        readonly reject: (reason?: any) => void;
    };
    readonly retryState: RetryState;
};

const enum TaskQueueEvents {
    TASK_ADDED = "task-added",
    TASK_STARTED = "task-started",
    TASK_ERROR_EVALUATE_RETRY = "task-error-evaluate-retry",
    TASK_FINISHED = "task-finished",
}

type TaskAddedEvent<T> = { readonly td: TaskDescriptor<T> };
type TaskStartedEvent<T> = { readonly task: Promise<T>; readonly td: TaskDescriptor<T> };
type TaskErrorEvent<T> = {
    readonly task: Promise<T>;
    readonly td: TaskDescriptor<T>;
    readonly result: "error";
    readonly error: any;
};
type TaskSuccessEvent<T> = {
    readonly task: Promise<T>;
    readonly td: TaskDescriptor<T>;
    readonly result: "success";
    readonly data: T;
};
type TaskFinishedEvent<T> = TaskSuccessEvent<T> | TaskErrorEvent<T>;

/**
 * A queue that executes computations in sequence, with a retry policy with exponential backoff.
 * Every time the execution fails `retryPolicy.shouldRetry` is used to now if retry the computation.
 * Min backoff time can be passed, else it starts from 1ms
 */
export class TasksQueue<
    /**
     The return type of the tasks in the queue. Defaults to void.
     */
    T = void
> {
    private taskAdded = 0;
    private runningTask = false;
    private readonly logger: LoggerType;
    private readonly eventEmitter = new EventEmitter();
    private tasks: TaskDescriptor<T>[] = [];
    readonly retryPolicy?: Required<RetryPolicy>;

    constructor(logger?: LoggerType | undefined, retryPolicy?: RetryPolicy) {
        this.logger = logger || console;

        if (retryPolicy) {
            assert(
                retryPolicy.minBackOffTime === undefined || (Number.isInteger(retryPolicy.minBackOffTime) && retryPolicy.minBackOffTime > 0),
                "retryPolicy.minBackOffTime must be an integer > 0"
            );

            this.retryPolicy = {
                minBackOffTime: retryPolicy.minBackOffTime === undefined ? 1 : retryPolicy.minBackOffTime,
                shouldRetry: retryPolicy.shouldRetry,
            };
        }

        // Attach event listeners
        this.eventEmitter.on(TaskQueueEvents.TASK_ADDED, this.onEventTaskAdded.bind(this));
        this.eventEmitter.on(TaskQueueEvents.TASK_ERROR_EVALUATE_RETRY, this.onEventTaskErrorEvaluateRetry.bind(this));
        this.eventEmitter.on(TaskQueueEvents.TASK_FINISHED, this.onEventTaskFinished.bind(this));
        this.eventEmitter.on(TaskQueueEvents.TASK_STARTED, this.onEventTaskStarted.bind(this));
    }

    /**
     * @returns `true` if there is a task executing
     */
    isTaskRunning(): boolean {
        return this.runningTask;
    }

    /**
     * @returns `true` if there are tasks waiting to start an execution
     */
    areTasksPending(): boolean {
        return this.tasks.length > 0;
    }

    /**
     * @returns `true` if there is a task executing or there are tasks waiting to start an execution
     */
    areTasksRunningOrPending(): boolean {
        return this.runningTask || this.tasks.length > 0;
    }

    private onEventTaskStarted(event: TaskStartedEvent<T>) {
        this.logger.debug(`Started task ${event.td.counter}`);
    }

    private async onEventTaskAdded(event: TaskAddedEvent<T>) {
        this.logger.debug(`Added task ${event.td.counter}`);
        await this.checkAndDoNextTask();
    }

    private onEventTaskErrorEvaluateRetry(event: TaskErrorEvent<T>) {
        const retryPolicy = this.retryPolicy;

        // If there is no retry policy, simply emit event finished and trigger promise completion
        if (retryPolicy === undefined) {
            this.eventEmitter.emit(TaskQueueEvents.TASK_FINISHED, event);
            return;
        }

        // Check if should retry
        let retry = false;
        try {
            retry = retryPolicy.shouldRetry(event.td.retryState.retries, event.error);
        } catch (e) {
            this.logger.error(e);
        }

        if (retry) {
            this.logger.debug(`Finished task ${event.td.counter} with error "${event.error.toString()}". Retry`);

            // Put mutable object in a variable, any modifications will mutate the task descriptor, also
            const tdRetryState = event.td.retryState;

            // Increment retries and calculate next execution
            // Double last backoff time
            const backoff = tdRetryState.lastBackoffTime === undefined ? retryPolicy.minBackOffTime : tdRetryState.lastBackoffTime * 2;
            const nextExecution = Date.now() + backoff;
            tdRetryState.retries++;
            tdRetryState.lastBackoffTime = backoff;
            tdRetryState.notBefore = nextExecution;

            this.logger.debug(
                `Retrying task ${event.td.counter} for the ${event.td.retryState.retries}nth time with backoff ${backoff}ms and next execution at ${new Date(
                    nextExecution
                ).toString()}`
            );

            // Add new task and trigger queue consumption
            this.addTask(event.td);
        } else {
            // Emit event task finished and trigger queue consumption
            this.eventEmitter.emit(TaskQueueEvents.TASK_FINISHED, event);
        }
    }

    private async onEventTaskFinished(event: TaskFinishedEvent<T>) {
        this.logger.debug(`Finished task ${event.td.counter} with result ${event.result}`);

        if (!this.areTasksRunningOrPending()) this.logger.debug(`Tasks queue empty`);

        switch (event.result) {
            case "success":
                event.td.promiseCbs.resolve(event.data);
                break;
            case "error":
                event.td.promiseCbs.reject(event.error);
                break;
        }

        // Check and do nest task
        await this.checkAndDoNextTask();
    }

    /**
     * Wait until all tasks in the queue are completed, with or without errors.
     * If some tasks failed,this method waits until the retryPolicy returns `false` for all failed tasks already in the queue.
     * After this method completes, the queue is empty and there are no tasks executing.
     */
    waitAllTasks(): Promise<void> {
        if (!this.areTasksRunningOrPending()) return Promise.resolve();

        return new Promise<void>((resolve, reject) => {
            const callback = (event: TaskFinishedEvent<T>) => {
                if (this.runningTask || this.tasks.length > 0) return;

                this.eventEmitter.off(TaskQueueEvents.TASK_FINISHED, callback);

                switch (event.result) {
                    case "success":
                        resolve();
                        break;
                    case "error":
                        resolve();
                        break;
                }
            };

            this.eventEmitter.on(TaskQueueEvents.TASK_FINISHED, callback);
        });
    }

    /**
     * Thought for debug purposes. At the passed interval are logged the current number of tasks waiting to start an execution and if there is currently a task executing.
     * @param pollInterval Number of milliseconds at which log. Defaults to 1000ms (1s)
     */
    pollAndLogPendingTasks(pollInterval = 1000) {
        const logPendingTasks = () => {
            this.logger.debug(`Waiting tasks: ${this.tasks.length}. Is a task running: ${this.runningTask}`);
        };

        return setInterval(logPendingTasks, pollInterval);
    }

    /**
     * Add work to the queue. The task is in the form of a callback that returns a promise. The promise returned at each callback invocation represents a task execution.
     * This method return a promise that completes with result of the task, or with the rejection error, and includes all the retries done.
     * @param work A callback that returns a promise that executes the task one time
     * @returns A promise that terminates with the result of the execution of the task, if successful. The promise includes all the retries done.
     */
    addWork(work: TaskDescriptor<T>["taskCreator"]): Promise<T> {
        let promiseCbs: TaskDescriptor<T>["promiseCbs"] = {
            resolve: _ => {},
            reject: _ => {},
        };

        const promise = new Promise<T>((resolve, reject) => {
            promiseCbs = { resolve, reject };
            // resolve and reject callbacks are called when TaskQueueEvents.TASK_FINISHED event is fired for this task
        });

        const td: TaskDescriptor<T> = { taskCreator: work, counter: ++this.taskAdded, promiseCbs, retryState: { retries: 0 } };
        this.addTask(td);

        return promise;
    }

    private addTask(td: TaskDescriptor<T>): void {
        this.tasks.push(td);
        const addedEvent: TaskAddedEvent<T> = { td };
        this.eventEmitter.emit(TaskQueueEvents.TASK_ADDED, addedEvent);
    }

    private checkAndDoNextTask(): Promise<void> {
        if (this.isTaskRunning()) return Promise.resolve();

        return this.doNextTask();
    }

    private async doNextTask(): Promise<void> {
        if (this.runningTask) throw new Error("Can't do next task, there is already one running");

        // No remaining tasks in queue
        if (this.tasks.length === 0) return Promise.resolve();

        const now = Date.now();
        const canBeExecutedNow = (td: TaskDescriptor<T>): boolean => td.retryState.notBefore === undefined || td.retryState.notBefore <= now;

        const first = this.tasks[0];
        let td: TaskDescriptor<T> | undefined = this.tasks.shift();

        // Iterate over the array until a task that can be executed now is found, or all the tasks have been iterated
        do {
            // Queue is empty
            if (!td) break;

            // Task can be executed now
            if (canBeExecutedNow(td)) break;

            // The task can not be executed now, must be executedN NOT before a certain time, according the applied retry policy, so put it back in the queue
            this.tasks.push(td);

            // Next task in the queue
            td = this.tasks.shift();

            //Exit the loop if the next task is the first task, because we iterated all the queue
        } while (td !== first);

        assert(td, "Expected td to be defined")

        // There is no task that can be executed now, program a timeout to start the nearest task in time
        if (td === first && !canBeExecutedNow(td)) {
            //Put td back in the queue
            this.tasks.push(td);

            // Task descriptors that can be executed before in time comes first
            function compareExecutionTime(td1: TaskDescriptor<T>, td2: TaskDescriptor<T>): number {
                if (td1.retryState.notBefore === td2.retryState.notBefore) return 0;

                if (td1.retryState.notBefore === undefined) return -1;

                if (td2.retryState.notBefore === undefined) return 1;

                return td1.retryState.notBefore - td2.retryState.notBefore;
            }

            let nearI = 0;
            let nearTd = this.tasks[0];

            //Find task descriptor with nearest execution time, put in nearTd, and its index in nearI
            for (let i = 1; i < this.tasks.length; i++) {
                const td = this.tasks[i];

                if (compareExecutionTime(td, nearTd) < 0) {
                    nearI = i;
                    nearTd = td;
                }
            }

            // Move nearTd to first position in the tasks array, if nearI === 0, it's already in the first position
            if (nearI !== 0) {
                const res = this.tasks.slice(nearI).concat(this.tasks.slice(0, nearI));
                this.tasks = res;
            }

            assert(this.tasks[0].retryState.notBefore !== undefined, "Expected notBefore value to be defined");

            // Set a timeout to check for next task execution 1ms after the retryState.notBefore value for the first task in the queue
            const now = Date.now();
            const nextCheckTask = this.tasks[0].retryState.notBefore - now + 1;
            this.logger.debug(`Set next task check for execution at ${new Date(now + nextCheckTask).toString()}`);
            setTimeout(() => {
                this.checkAndDoNextTask();
            }, nextCheckTask);

            return;
        }

        // td contains a task descriptor that can be executed now

        //Start an execution of the task
        assert(!this.runningTask, "Expected to be no running task");
        this.runningTask = true;
        const task = td.taskCreator();

        const startedEvent: TaskStartedEvent<T> = { task, td };
        this.eventEmitter.emit(TaskQueueEvents.TASK_STARTED, startedEvent);

        // Wait for the task to finish
        let finishedEvent: TaskFinishedEvent<T>;
        try {
            const data = await task;
            finishedEvent = { ...startedEvent, result: "success", data };
        } catch (e) {
            finishedEvent = { ...startedEvent, result: "error", error: e };
        } finally {
            this.runningTask = false;
        }

        // If task has error and there is a retry policy, emit event TaskQueueEvents.TASK_ERROR_EVALUATE_RETRY and evaluate the retry policy, else emit TaskQueueEvents.TASK_FINISHED
        if (finishedEvent.result === "error" && this.retryPolicy) {
            this.eventEmitter.emit(TaskQueueEvents.TASK_ERROR_EVALUATE_RETRY, finishedEvent);
        } else {
            this.eventEmitter.emit(TaskQueueEvents.TASK_FINISHED, finishedEvent);
        }
    }
}
