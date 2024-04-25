import {TasksPool} from "../src/tasks-pool.js";
import {waitTime} from "./wait-time";

describe("TasksPool", () => {
    describe("Just created", () => {
        let pool: TasksPool;

        beforeEach(() => {
            pool = new TasksPool();
        })

        test("No pending tasks", async () => {
            expect(pool.getPendingTasks()).toEqual(0);
        })

        test("waitAtMostPendingTasks() terminates immediately and returns 0", async () => {
            await expect(pool.waitAtMostPendingTasks(0)).resolves.toEqual(0);
        }, 1)
    })

    describe("Wait tasks", () => {
        const taskCreator = (i: number) => waitTime(50 + i * 20)
        const tasksCount = 10;
        const maxParallelization = 5;
        let pool: TasksPool

        beforeEach(() => {
            pool = new TasksPool()

            for (let i = 1; i <= tasksCount; i++) {
                pool.addTask(taskCreator(i))
            }
        })

        test(`There are exactly ${tasksCount} tasks`, async () => {
            expect(pool.getPendingTasks()).toEqual(tasksCount)
        })

        test("Wait one task", async () => {
            expect(pool.getPendingTasks()).toEqual(tasksCount)
            const remainingTasks = await pool.waitSomePendingTasks();
            expect(remainingTasks).toBeLessThanOrEqual(tasksCount - 1)
            expect(pool.getPendingTasks()).toEqual(remainingTasks)
        })

        test("Wait all tasks", async () => {
            expect(pool.getPendingTasks()).toEqual(tasksCount)
            const remainingTasks = await pool.waitAtMostPendingTasks(0);
            expect(remainingTasks).toBe(0)
            expect(pool.getPendingTasks()).toEqual(remainingTasks)
        })

        test(`Keep max parallelization to ${maxParallelization} tasks`, async () => {
            expect(pool.getPendingTasks()).toEqual(tasksCount)
            expect(pool.getPendingTasks()).toBeGreaterThan(maxParallelization)
            const remainingTasks = await pool.waitAtMostPendingTasks(maxParallelization)
            expect(remainingTasks).toBeLessThanOrEqual(maxParallelization)
            expect(pool.getPendingTasks()).toEqual(remainingTasks)
        })

        afterEach(async () => {
            await pool.waitAtMostPendingTasks(0)
        }, 500)
    })
})
