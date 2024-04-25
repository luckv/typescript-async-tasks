Sorry for my terrible english, if you see any errors.

# Do work concurrently in NodeJS

A simple collection of classes available for public usage (it's a MIT license) to handle concurrent work in NodeJS. All the code is under the directory `src`

The classes:

- [`TasksPool`](#lib-taskspool) in the file `tasks-pool.ts`. Handles concurrent work, but can apply a limit to the parallelization of tasks.

- [`TasksQueue`](#lib-tasksqueue) in the file `tasks-queue.ts`. Handles a queue of tasks, that need to be executed in sequence, with an optional retry policy that uses exponential backoff.

## Taking advantage of the thread model of NodeJS and the use of `EventEmitter`

### Single thread model quickly explained

When we call an `async` function within our code in a NodeJS process, we are not really executing it the asynchronous way many people would think: in another thread, doing parallel work. Instead we are putting that execution at the end of a queue of tasks that the thread will execute in a sequential order, that structure is called the thread loop. Doing parallel work that includes I/O operations use, instead, some parallel threads different from the thread loop, but only for the I\O work (network, file system) of task.
This model was successful amid developers because it permits to avoid concurrency problems.

If you want to know more about the single thread model of NodeJS, I found this reading: https://www.zartis.com/nodejs-threads-and-the-event-loop/

### Taking advantage of the thread model

What is the big advantage of using the single thread model for this case? No concurrency, all the async code of the class would have been in execution without worrying about concurrent modifications of shared variables. So I could use private variables to keep track of shared state, like the number of tasks running in parallel.

### Use of `EventEmitter`

After having my tasks runnning, I had another problem to solve, how to wait until tasks were completed? The simplest solution that came to my mind was to write an `async` method with a `while()` loop that used `setTimeout` wrapped in a promise. At every loop the code would have checked if the was reached, if yes the method returned, if not the method did another loop. That would have been a very inefficient solution, because at every loop it used a little portion of the cpu time of the thread loop, depriving other code of that time. Moreover it's not instantenous, because between the reaching of the desired confition and the termination of the waiting method, would have been passed an entire cicle of the `while()` loop, with cpu time, and real time, waste.

The solution was to use an instance of the `EventEmitter` class, a private property, and to trigger specific events. When a method wants to react to a specific event, would have to simply attach a listener to that event.

# <a id="lib-taskspool" /> TasksPool

All the code is in the file `tasks-pool.ts`. The work is handled in form of `Promise<void>` and is called '*task*'. The errors of the rejected promise task's are printed to the logger.

### Features

- Handling of arbitrary number of parallel tasks. The only limit is the system resources in which the application is running
- Waiting for some tasks to complete
- Waiting until the remaining number of tasks in execution are below a certain value
- Generate tasks and put them in the pool, keeping a maximum number of parallel tasks in execution

### Why?

Because I have noted at my work that executing a big number of parallel tasks (over 1000), with I\O work, in NodeJS without an upper bound of parallel tasks, take down the system performance at managing all that tasks. So I had to write a solution to handle asynchronous executions, that keeps a limit on the number of parallel tasks.

With handsight, probably the root cause could have been the limited number of treads responsible for handling I\O work. NodeJS was already doing a great work at managing all the async tasks I launched at him. Anyway, I'll keep this code here to prove, to anyone who visits my profile, my skills and my dedication of solving problems.

Taking advantage of the thread model of NodeJS and the use of `EventEmitter`

### Taking advantage of the thread model of NodeJS and the use of `EventEmitter`

#### Taking advantage of the thread model

What is the big advantage of using the single thread model for this case? No concurrency, all the async code of the class would have been in execution without worrying about concurrent modifications of shared variables. So I used a private property of the class to keep track of the number of pending tasks in the pool. The property is incremented when a new task is added and decremented when the task finished, using the `finally()` handler of the promise, that will have been executed asynchronously.

#### Use of `EventEmitter`

After having my tasks runnning, I had another problem to solve, how to wait until some tasks were completed? The simplest solution that came to my mind was to write an `async` method with a `while()` loop that used `setTimeout` wrapped in a promise. At every loop the code would have checked if the value of `pendingTasks` has changed, if yes the method returned, if not the method did another loop. That would have been a very inefficient solution, because at every loop it used a little portion of the cpu time of the thread loop, depriving other code of that time. Moreover it's not instantenous, because between the reaching of the target number of tasks and the termination of the waiting method, would have been passed an entire cicle of the `while()` loop, with cpu time, and real time, waste

The solution was to use an instance of the `EventEmitter` class, a private property, Every time a task was added or terminated, an event `"completed"` was fired by the event emitter with the number of pending tasks after the operation. The methods that wanted to wait for some tasks, would have to subscribe to the event emitter, wrap the usage in a promise, and when the number of tasks would have reached the desired number, the promise would have been resolved. In this way was totally possible to wait for an exact number of remaining tasks, and to obtain the desidered parallelization. More than one caller can invoke the methods of this class without any concurrency problems, the events are delivered to all the callers.

Taking advantage of the thread model of NodeJS and the use of `EventEmitter`

# <a id="lib-tasksqueue" /> TasksQueue

All the code is in the file `tasks-queue.ts`. The work is handled in form of tasks creator, `() => Promise<T>`, every invocation of the callback correspond to a task execution.

An optional retry policy can be set to choose when to retry a failed task.

All work added to the queue is guaranteed to never be executed in parallell with other work submitted to this class, and respecting a FIFO (First In First Out) policy.

### Features

- Transparent sequential execution of tasks. All work added to the queue is guaranteed to be executed sequentially.
- When work is added, a promise is returned that wrap the entire task execution, with its retries.
- Waiting for all task in the queue to be completed.
- Apply a retry policy when a task fails. It's optional and if not applied the task will not be retried at the first fail.

### Why?

I had a problem with an external service we used at work, that has a limit of 1 invocation a time from the same client. It was not a problem of rate at which these invocations were made, but the invocations couldn't be done in parallel.

This was for me a major issue, because those invocations were made as a result of bigger parallel work on a set of data. And making all that work sequential, wasn't a feasible option.

So i decided to write this solution to permit to continue to invoke the service in parallel, but with a 'layer', that was `TasksQueue`, that transparently enforces sequential executions and retries on fail.

Maybe there were better solution to my problem. Anyway, I'll keep this code here to prove, to anyone who visits my profile, my skills and my dedication of solving problems.



# Use the classes

## Pass a custom logger

The class constructors accepts an optional object to be used as custom logger instead of `console`. Because the class only use the methods `debug` and `error` of the `console` type, the constructor parameter has type `Pick<typeof console, 'debug' | 'error'>`.

## Build javascript

The `build` script generate javascript code to be used in a codebase without typescript. Code is not minified and comments and jsdocs are not removed.

```
$ npm run build
```
