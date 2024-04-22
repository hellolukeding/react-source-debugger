# React 源码阅读记录

## 说明

## React工作循环

![1712975887554](https://7km.top/static/workloop.ef1c7673.png)
![1712975887555](https://cdn.ipfsscan.io/ipfs/Qmas27xKRmVDFDwDHYwD5oAgd2HzAjouTzXJ3xnPEoFKuk?filename=image.png)

## 三个全局对象

1. [`ReactDOM(Blocking)Root`对象](https://github.com/facebook/react/blob/v17.0.2/packages/react-dom/src/client/ReactDOMRoot.js#L62-L72)

- 属于 `react-dom`包, 该对象[暴露有 `render,unmount`方法](https://github.com/facebook/react/blob/v17.0.2/packages/react-dom/src/client/ReactDOMRoot.js#L62-L104), 通过调用该实例的 `render`方法, 可以引导 react 应用的启动.

2. [`fiberRoot`对象](https://github.com/facebook/react/blob/v17.0.2/packages/react-reconciler/src/ReactFiberRoot.old.js#L83-L103)
   - 属于 `react-reconciler`包, 作为 `react-reconciler`在运行过程中的全局上下文, 保存 fiber 构建过程中所依赖的全局状态.
   - 其大部分实例变量用来存储 `fiber 构造循环`(详见[`两大工作循环`](https://7km.top/main/workloop))过程的各种状态.react 应用内部, 可以根据这些实例变量的值, 控制执行逻辑.
3. [`HostRootFiber`对象](https://github.com/facebook/react/blob/v17.0.2/packages/react-reconciler/src/ReactFiber.old.js#L431-L449)
   - 属于 `react-reconciler`包, 这是 react 应用中的第一个 Fiber 对象, 是 Fiber 树的根节点, 节点的类型是 `HostRoot`.

## React 调度实现

> 调度中心核心代码[SchedulerHostConfig.default.js](https://github.com/facebook/react/blob/v17.0.2/packages/scheduler/src/forks/SchedulerHostConfig.default.js)

### 请求调度 requestHostCallback

```javascript
//请求调度
requestHostCallback = function (callback) {
  // 1. 保存callback
  scheduledHostCallback = callback;
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    // 2. 通过 MessageChannel 发送消息
    port.postMessage(null);
  }
};
```

### 取消调度 cancleHostCallback

```javascript
cancelHostCallback = function () {
   scheduledHostCallback = null;
}
```

### 时间切片

```javascript
const localPerformance = performance;
// 获取当前时间
getCurrentTime = () => localPerformance.now();

// 时间切片周期, 默认是5ms(如果一个task运行超过该周期, 下一个task执行之前, 会把控制权归还浏览器)
let yieldInterval = 5;
// 当前时间切片的截止时间
let deadline = 0;
// 最大时间切片周期
const maxYieldInterval = 300;

let needsPaint = false;
/**
 * @info https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending
 * @description 判断当前是否有用户尝试和页面进行交互
 */
const scheduling = navigator.scheduling;
// 是否让出主线程
shouldYieldToHost = function () {
  const currentTime = getCurrentTime();
  if (currentTime >= deadline) {
    if (needsPaint || scheduling.isInputPending()) {
      // There is either a pending paint or a pending input.
      return true;
    }
    // There's no pending input. Only yield if we've reached the max
    // yield interval.
    return currentTime >= maxYieldInterval; // 在持续运行的react应用中, currentTime肯定大于300ms, 这个判断只在初始化过程中才有可能返回false
  } else {
    // There's still time left in the frame.
    return false;
  }
};

// 请求绘制
requestPaint = function () {
  needsPaint = true;
};

// 设置时间切片的周期
forceFrameRate = function (fps) {
  if (fps < 0 || fps > 125) {
    // Using console['error'] to evade Babel and ESLint
    console['error'](
      'forceFrameRate takes a positive int between 0 and 125, ' +
        'forcing frame rates higher than 125 fps is not supported',
    );
    return;
  }
  if (fps > 0) {
    yieldInterval = Math.floor(1000 / fps);
  } else {
    // reset the framerate
    yieldInterval = 5;
  }
};
```

### 完整调度

```javascript
const performWorkUntilDeadline = () => {
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime(); // 1. 获取当前时间
    deadline = currentTime + yieldInterval; // 2. 设置deadline
    const hasTimeRemaining = true;
    try {
      // 3. 执行回调, 返回是否有还有剩余任务
      const hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime);
      if (!hasMoreWork) {
        // 没有剩余任务, 退出
        isMessageLoopRunning = false;
        scheduledHostCallback = null;
      } else {
        port.postMessage(null); // 有剩余任务, 发起新的调度
      }
    } catch (error) {
      port.postMessage(null); // 如有异常, 重新发起调度
      throw error;
    }
  } else {
    isMessageLoopRunning = false;
  }
  needsPaint = false; // 重置开关
};
```
![](https://7km.top/static/core.e65ca659.png)

## Q&A

1. > Q: React Hydration是什么，有什么作用，是如何实现的?
   > A: React Hydration 是 React 在服务器端渲染（SSR）中的一个重要概念。它的主要作用是在客户端接管（或 "激活"）服务器渲染的 HTML。
   >
   > 在服务器端渲染（SSR）中，React 组件会被渲染成字符串形式的 HTML，然后发送到客户端。然而，这些 HTML 是静态的，无法响应用户交互。为了让这些 HTML 变得可以交互，React 提供了一个过程叫做 "hydration"。在 hydration 过程中，React 会遍历服务器渲染的 HTML，为每个 HTML 元素创建对应的 React 组件实例，并添加事件监听器，使得这些 HTML 变得可以响应用户交互。这个过程通常在页面首次加载完成后进行，由 `ReactDOM.hydrate` 函数触发。`ReactDOM.hydrate` 函数的使用方式与 `ReactDOM.render` 函数类似，都是接受一个 React 元素和一个 DOM 容器作为参数。但是，`ReactDOM.hydrate` 函数会假设 DOM 容器中的内容是由服务器渲染的 HTML，并尝试复用这些 HTML，而不是重新渲染。
   >
   > ```javascript
   > ReactDOM.hydrate(<App />, document.getElementById("root"));
   > ```
   >
2. > Q: React 源码中，react-reconciler是如何实现调度的？
   > A:
   >
   > 1. **接收更新** ：当一个组件需要更新（例如，由于状态变化或接收到新的 props）时，React 会在这个组件的 Fiber 节点上调度一个更新。这通常通过 `scheduleUpdateOnFiber` 函数完成。
   > 2. **安排工作** ：React 会根据更新的优先级（在 React 中，这被称为 "lane"）来决定何时处理这个更新。优先级高的更新会被优先处理，优先级低的更新可能会被推迟。这通常通过 `ensureRootIsScheduled` 和 `scheduleUpdateOnFiber` 函数完成。
   > 3. **开始工作循环** ：当有待处理的更新时，React 会开始一个新的工作循环。在工作循环中，React 会遍历 Fiber 树，找到需要更新的 Fiber 节点，并生成一个新的 Fiber 树。这通常通过 `performUnitOfWork` 和 `workLoop` 函数完成。
   > 4. **提交更新** ：当新的 Fiber 树准备好后，React 会将其提交到 DOM。这会导致浏览器重新渲染 UI。这通常通过 `commitRoot` 函数完成。
   >
3. > Q: markContainerAsRoot是如何将dom与fiber关联起来
   > A：
   >
   > `markContainerAsRoot` 是 React 的内部函数，它的主要作用是将一个 DOM 容器（通常是你的 React 应用的根 DOM 节点）和一个 FiberRoot 对象关联起来。这个函数在 React 的源码中的实现如下：
   >
   > ```javascript
   > function markContainerAsRoot(hostRoot, node) {
   >   node[internalContainerInstanceKey] = hostRoot;
   > }
   > ```
   > 在这段代码中，`hostRoot` 是一个 FiberRoot 对象，`node` 是一个 DOM 容器。`internalContainerInstanceKey` 是一个特殊的 key，它在 React 的源码中被定义为一个 Symbol。
   >
   > 这个函数将 FiberRoot 对象 `hostRoot` 存储在 DOM 容器 `node` 的 `internalContainerInstanceKey` 属性中。这样，我们就可以通过 DOM 容器获取到对应的 FiberRoot 对象。
   >
4. > Q: React的可中断渲染是如何实现的？
   > A：
   >
   > 1. **调度更新** ：当一个组件需要更新时，React 会在这个组件的 Fiber 节点上调度一个更新。这个更新会被分配到一个特定的 lane（优先级）。
   > 2. **开始工作循环** ：React 会开始一个新的工作循环。在工作循环中，React 会遍历 Fiber 树，找到需要更新的 Fiber 节点，并生成一个新的 Fiber 树。这个过程被称为 "reconciliation"。
   > 3. **中断和恢复工作** ：在工作循环中，React 可以根据需要中断和恢复工作。例如，当有一个高优先级的更新需要处理时，React 可以中断当前的工作，转而处理这个高优先级的更新。然后，当高优先级的更新处理完后，React 可以恢复之前被中断的工作。这就是所谓的 "可中断" 渲染。
   > 4. **提交更新** ：当新的 Fiber 树准备好后，React 会将其提交到 DOM。这会导致浏览器重新渲染 UI。
   >
   >    ```javascript
   >    // 调度更新
   >    function scheduleUpdateOnFiber(fiber, lane) {
   >      // 将更新添加到 fiber 的更新队列中
   >      fiber.updateQueue.push({
   >        lane,
   >        // ...其他更新信息
   >      });
   >
   >      // 安排工作
   >      scheduleWork(fiber, lane);
   >    }
   >
   >    // 安排工作
   >    function scheduleWork(fiber, lane) {
   >      // 根据 lane（优先级）决定何时开始这个更新
   >      // ...
   >
   >      // 开始工作循环
   >      workLoop();
   >    }
   >
   >    // 工作循环
   >    function workLoop() {
   >      while (nextUnitOfWork !== null) {
   >        // 执行一个工作单元，并获取下一个工作单元
   >        nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
   >      }
   >    }
   >
   >    // 执行一个工作单元
   >    function performUnitOfWork(unitOfWork) {
   >      // 更新这个 fiber 节点
   >      // ...
   >
   >      // 返回下一个工作单元
   >      return unitOfWork.child;
   >    }
   >
   >    // 提交更新
   >    function commitRoot(root) {
   >      // 遍历新的 Fiber 树，并将其提交到 DOM
   >      // ...
   >    }
   >    ```
   >
