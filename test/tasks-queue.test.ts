import {waitTime} from "./wait-time";
import {TasksQueue} from "../src/tasks-queue";
import * as console from "node:console";

type TaskCreatorTest<T> = { result: "success", value: T, work: () => Promise<T> } | {
    result: "failure",
    error: Error,
    work: () => Promise<T>
}

function taskCreatorCreator<E extends Error>(i: number, throws: boolean = false): TaskCreatorTest<symbol> {
    const retVal = Symbol(i)
    const error = new Error(`Task ${i} failed`)

    const work = async () => {
        await waitTime(50 + i * 20)

        if (throws) {
            throw new Error(`Task ${i} failed`)
        } else
            return retVal;
    }

    if (throws) {
        return {result: "failure", error: error, work};
    } else {
        return {result: "success", value: retVal, work};
    }
}

describe("TasksQueue", () => {
    describe("Just created", () => {
        let queue: TasksQueue;

        beforeEach(() => {
            queue = new TasksQueue();
        })

        test("isTaskRunning() returns false", async () => {
            expect(queue.isTaskRunning()).toBe(false);
        })

        test("areTasksPending() returns false", async () => {
            expect(queue.areTasksPending()).toBe(false)
        })

        test("areTasksRunningOrPending() returns false", async () => {
            expect(queue.areTasksRunningOrPending()).toBe(false)
        })

        test("waitAllTasks() terminates immediately", async () => {
            await expect(queue.waitAllTasks()).resolves.toBeUndefined()
        }, 1)
    })

    describe("Without retry policy", () => {
        const tasksCount = 10;
        let queue: TasksQueue<symbol>;
        let taskCreators: TaskCreatorTest<symbol>[];

        beforeEach(() => {
            queue = new TasksQueue({
                ...console, debug: () => {
                }
            });
            taskCreators = []
            for (let i = 0; i < tasksCount; i++)
                taskCreators.push(taskCreatorCreator(i, i % 2 === 0))
        })

        test("after one work has been added isTaskRunning() returns true", () => {
            queue.addWork(taskCreators[0].work)

            expect(queue.isTaskRunning()).toBe(true);
        })

        test("after some work has been added isTaskRunning() returns true", () => {
            taskCreators.forEach(tc => queue.addWork(tc.work))

            expect(queue.isTaskRunning()).toBe(true);
        })

        test("after one work has been added areTasksRunningOrPending() returns true", async () => {
            queue.addWork(taskCreators[0].work)

            expect(queue.areTasksRunningOrPending()).toBe(true)
        })

        test("after some work has been added areTasksRunningOrPending() returns true", async () => {
            taskCreators.forEach(tc => queue.addWork(tc.work))

            expect(queue.areTasksRunningOrPending()).toBe(true)
        })

        test("added work return the correct data", async () => {
            const expectedResultsPromise = Promise.allSettled(taskCreators.map(tc => tc.work()))
            const queueResultsPromise = Promise.allSettled(taskCreators.map(tc => queue.addWork(tc.work)))
            const [expectedResults, queueResults] = await Promise.all([expectedResultsPromise, queueResultsPromise])

            expect(queueResults).toEqual(expectedResults)
        })

        test("after waitAllTasks() there are no running or pending tasks", async () => {
            try {
                taskCreators.forEach(tc => queue.addWork(tc.work))
            } catch (err) {
                console.error(err)
            }

            await queue.waitAllTasks();

            expect(queue.isTaskRunning()).toBe(false);
            expect(queue.areTasksPending()).toBe(false)
            expect(queue.areTasksRunningOrPending()).toBe(false)
        })

        afterEach(async () => {
            await queue.waitAllTasks();
        })
    })
})
