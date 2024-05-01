# React 源码阅读记录

## 说明

## `createElement`函数

## render函数

## 并发模式

## fiber

React 的 Fiber 是一种数据结构，用于跟踪组件树的状态和属性。每个 Fiber 对象代表一个组件实例，并且包含了关于该组件的信息，如其类型（函数组件、类组件、DOM 元素等）、props、state、以及与其他 Fiber 的关系（父 Fiber、子 Fiber、兄弟 Fiber 等）。

Fiber 的主要作用如下：

1. **支持时间切片** ：Fiber 架构使得 React 可以在渲染过程中暂停和恢复工作。这使得 React 可以将长时间运行的渲染任务分解成多个小任务，从而避免阻塞主线程，提高应用的响应性。
2. **支持并发模式** ：Fiber 架构使得 React 可以在多个更新之间切换，这使得 React 可以根据更新的优先级来决定先执行哪个更新，从而实现并发模式。
3. **支持 Hooks** ：Fiber 架构使得 React 可以跟踪组件的生命周期，这使得 React 可以实现 Hooks，Hooks 允许你在函数组件中使用 state 和其他 React 特性。
4. **支持 Suspense** ：Fiber 架构使得 React 可以在组件树中暂停和恢复渲染，这使得 React 可以实现 Suspense，Suspense 允许你在组件渲染等待异步数据时显示一些 fallback 内容。

`fiber`创建阶段需要做三件事：

+ 将元素添加到dom
+ 为元素的子元素创建fiber
+ 选择下一个工作单元

在正式解读 `fiber树构造`之前, 再次回顾一下[reconciler 运作流程](https://7km.top/main/reconciler-workflow)的 4 个阶段:

![](https://7km.top/static/reactfiberworkloop.b647e134.png)

1. 输入阶段: 衔接 `react-dom`包, 承接 `fiber更新`请求(可以参考[React 应用的启动过程](https://7km.top/main/bootstrap)).
2. 注册调度任务: 与调度中心(`scheduler`包)交互, 注册调度任务 `task`, 等待任务回调(可以参考[React 调度原理(scheduler)](https://7km.top/main/scheduler)).
3. 执行任务回调: 在内存中构造出 `fiber树`和 `DOM`对象, 也是 **fiber 树构造的重点内容** .
4. 输出: 与渲染器(`react-dom`)交互, 渲染 `DOM`节点.

### 初次创建

> 在 `React`应用首次启动时, 界面还没有渲染, 此时并不会进入对比过程, 相当于直接构造一棵全新的树.

#### 启动阶段

![](https://7km.top/static/process-legacy.99cd6b8d.png)

```javascript
function render(element, container) {
  // 创建一个 root Fiber
  const rootFiber = {
    tag: HostRoot,
    stateNode: {
      containerInfo: container,
    },
    child: null,
  };

  // 创建一个新的 Fiber 来代表 React 元素
  const newFiber = {
    tag: getTagFromElementType(element.type),
    type: element.type,
    props: element.props,
    return: rootFiber,
    sibling: null,
    child: null,
  };

  // 将新的 Fiber 添加到 root Fiber 的子节点
  rootFiber.child = newFiber;

  // 将 root Fiber 添加到更新队列
  scheduleUpdateOnFiber(rootFiber);
}
```

```javascript
// ... 省略了部分代码
export function updateContainer(
  element: ReactNodeList,
  container: OpaqueRoot,
  parentComponent: ?React$Component<any, any>,
  callback: ?Function,
): Lane {
  // 获取当前时间戳
  const current = container.current;
  const eventTime = requestEventTime();
  // 1. 创建一个优先级变量(车道模型)
  const lane = requestUpdateLane(current);

  // 2. 根据车道优先级, 创建update对象, 并加入fiber.updateQueue.pending队列
  const update = createUpdate(eventTime, lane);
  update.payload = { element };
  callback = callback === undefined ? null : callback;
  if (callback !== null) {
    update.callback = callback;
  }
  enqueueUpdate(current, update);

  // 3. 进入reconciler运作流程中的`输入`环节
  scheduleUpdateOnFiber(current, lane, eventTime);
  return lane;
}
```

![](https://7km.top/static/update-container.a5c20447.png)

#### 构造阶段

![](https://7km.top/static/initial-status.35133c81.png)

```javascript
function performSyncWorkOnRoot(root) {
  let lanes;
  let exitStatus;
  if (
    root === workInProgressRoot &&
    includesSomeLane(root.expiredLanes, workInProgressRootRenderLanes)
  ) {
    // 初次构造时(因为root=fiberRoot, workInProgressRoot=null), 所以不会进入
  } else {
    // 1. 获取本次render的优先级, 初次构造返回 NoLanes
    lanes = getNextLanes(root, NoLanes);
    // 2. 从root节点开始, 至上而下更新
    exitStatus = renderRootSync(root, lanes);
  }

  // 将最新的fiber树挂载到root.finishedWork节点上
  const finishedWork: Fiber = (root.current.alternate: any);
  root.finishedWork = finishedWork;
  root.finishedLanes = lanes;
  // 进入commit阶段
  commitRoot(root);

  // ...后面的内容本节不讨论
}
```

![](https://7km.top/static/status-freshstack.01a7f38b.png)

#### 循环构造

```javascript
function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

function workLoopConcurrent() {
  // Perform work until Scheduler asks us to yield
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}
```

```javascript
// ... 省略部分无关代码
function performUnitOfWork(unitOfWork: Fiber): void {
  // unitOfWork就是被传入的workInProgress
  const current = unitOfWork.alternate;
  let next;
  next = beginWork(current, unitOfWork, subtreeRenderLanes);
  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    // 如果没有派生出新的节点, 则进入completeWork阶段, 传入的是当前unitOfWork
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}
```

> 深度优先遍历
> workInProgress和current都视为指针
> workInProgress指向当前正在构造的fiber节点
> current = workInProgress.alternate(即fiber.alternate), 指向当前页面正在使用的fiber节点. 初次构造时, 页面还未渲染, 此时current = null.

整个循环遍历的内部，每个 `fiber`节点都会经历两个阶段，即遍历阶段和回溯阶段

```javascript
function beginWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  const updateLanes = workInProgress.lanes;
  if (current !== null) {
    // update逻辑, 首次render不会进入
  } else {
    didReceiveUpdate = false;
  }
  // 1. 设置workInProgress优先级为NoLanes(最高优先级)
  workInProgress.lanes = NoLanes;
  // 2. 根据workInProgress节点的类型, 用不同的方法派生出子节点
  switch (
    workInProgress.tag // 只保留了本例使用到的case
  ) {
    case ClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return updateClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case HostRoot:
      return updateHostRoot(current, workInProgress, renderLanes);
    case HostComponent:
      return updateHostComponent(current, workInProgress, renderLanes);
    case HostText:
      return updateHostText(current, workInProgress);
    case Fragment:
      return updateFragment(current, workInProgress, renderLanes);
  }
}
```

遍历阶段会根据节点类型采取不同的策略，总的目的都是为了找到下一个节点，将数据挂载到节点上

回溯阶段

+ 调用completeWork
+ 给fiber节点(tag=HostComponent, HostText)创建 DOM 实例, 设置fiber.stateNode局部状态(如tag=HostComponent, HostText节点: fiber.stateNode 指向这个 DOM 实例).
+ 为 DOM 节点设置属性, 绑定事件(这里先说明有这个步骤, 详细的事件处理流程, 在合成事件原理中详细说明).
+ 设置fiber.flags标记
+ 把当前 fiber 对象的副作用队列(firstEffect和lastEffect)添加到父节点的副作用队列之后, 更新父节点的firstEffect和lastEffect指针.
+ 识别beginWork阶段设置的fiber.flags, 判断当前 fiber 是否有副作用(增,删,改), 如果有, 需要将当前 fiber 加入到父节点的effects队列, 等待commit阶段处理.

```javascript
function completeUnitOfWork(unitOfWork: Fiber): void {
  let completedWork = unitOfWork;
  // 外层循环控制并移动指针(`workInProgress`,`completedWork`等)
  do {
    const current = completedWork.alternate;
    const returnFiber = completedWork.return;
    if ((completedWork.flags & Incomplete) === NoFlags) {
      let next;
      // 1. 处理Fiber节点, 会调用渲染器(调用react-dom包, 关联Fiber节点和dom对象, 绑定事件等)
      next = completeWork(current, completedWork, subtreeRenderLanes); // 处理单个节点
      if (next !== null) {
        // 如果派生出其他的子节点, 则回到`beginWork`阶段进行处理
        workInProgress = next;
        return;
      }
      // 重置子节点的优先级
      resetChildLanes(completedWork);
      if (
        returnFiber !== null &&
        (returnFiber.flags & Incomplete) === NoFlags
      ) {
        // 2. 收集当前Fiber节点以及其子树的副作用effects
        // 2.1 把子节点的副作用队列添加到父节点上
        if (returnFiber.firstEffect === null) {
          returnFiber.firstEffect = completedWork.firstEffect;
        }
        if (completedWork.lastEffect !== null) {
          if (returnFiber.lastEffect !== null) {
            returnFiber.lastEffect.nextEffect = completedWork.firstEffect;
          }
          returnFiber.lastEffect = completedWork.lastEffect;
        }
        // 2.2 如果当前fiber节点有副作用, 将其添加到子节点的副作用队列之后.
        const flags = completedWork.flags;
        if (flags > PerformedWork) {
          // PerformedWork是提供给 React DevTools读取的, 所以略过PerformedWork
          if (returnFiber.lastEffect !== null) {
            returnFiber.lastEffect.nextEffect = completedWork;
          } else {
            returnFiber.firstEffect = completedWork;
          }
          returnFiber.lastEffect = completedWork;
        }
      }
    } else {
      // 异常处理, 本节不讨论
    }

    const siblingFiber = completedWork.sibling;
    if (siblingFiber !== null) {
      // 如果有兄弟节点, 返回之后再次进入`beginWork`阶段
      workInProgress = siblingFiber;
      return;
    }
    // 移动指针, 指向下一个节点
    completedWork = returnFiber;
    workInProgress = completedWork;
  } while (completedWork !== null);
  // 已回溯到根节点, 设置workInProgressRootExitStatus = RootCompleted
  if (workInProgressRootExitStatus === RootIncomplete) {
    workInProgressRootExitStatus = RootCompleted;
  }
}
```

构造前
![](https://7km.top/static/unitofwork0.2b01ce04.png)
在上文已经说明, 进入循环构造前会调用prepareFreshStack刷新栈帧, 在进入fiber树构造循环之前, 保持这这个初始化状态:

performUnitOfWork第 1 次调用(只执行beginWork):
执行前: workInProgress指针指向HostRootFiber.alternate对象, 此时current = workInProgress.alternate指向fiberRoot.current是非空的(初次构造, 只在根节点时, current非空).
执行过程: 调用updateHostRoot
在reconcileChildren阶段, 向下构造次级子节点fiber(`<App/>`), 同时设置子节点(fiber(`<App/>`))fiber.flags |= Placement
执行后: 返回下级节点fiber(`<App/>`), 移动workInProgress指针指向子节点fiber(`<App/>`)
![](https://7km.top/static/unitofwork1.20aad56c.png)
performUnitOfWork第 2 次调用(只执行beginWork):
执行前: workInProgress指针指向fiber(`<App/>`)节点, 此时current = null
执行过程: 调用updateClassComponent
本示例中, class 实例存在生命周期函数componentDidMount, 所以会设置fiber(`<App/>`)节点workInProgress.flags |= Update
另外也会为了React DevTools能够识别状态组件的执行进度, 会设置workInProgress.flags |= PerformedWork(在commit阶段会排除这个flag, 此处只是列出workInProgress.flags的设置场景, 不讨论React DevTools)
需要注意classInstance.render()在本步骤执行后, 虽然返回了render方法中所有的ReactElement对象, 但是随后reconcileChildren只构造次级子节点
在reconcileChildren阶段, 向下构造次级子节点div
执行后: 返回下级节点fiber(div), 移动workInProgress指针指向子节点fiber(div)

![](https://7km.top/static/unitofwork2.5c1504a3.png)
performUnitOfWork第 3 次调用(只执行beginWork):
执行前: workInProgress指针指向fiber(div)节点, 此时current = null
执行过程: 调用updateHostComponent
在reconcileChildren阶段, 向下构造次级子节点(本示例中, div有 2 个次级子节点)
执行后: 返回下级节点fiber(header), 移动workInProgress指针指向子节点fiber(header)

![](https://7km.top/static/unitofwork3.e67196e2.png)
performUnitOfWork第 4 次调用(执行beginWork和completeUnitOfWork):
beginWork执行前: workInProgress指针指向fiber(header)节点, 此时current = null
beginWork执行过程: 调用updateHostComponent
本示例中header的子节点是一个直接文本节点,设置nextChildren = null(直接文本节点并不会被当成具体的fiber节点进行处理, 而是在宿主环境(父组件)中通过属性进行设置. 所以无需创建HostText类型的 fiber 节点, 同时节省了向下遍历开销.).
由于nextChildren = null, 经过reconcileChildren阶段处理后, 返回值也是null
beginWork执行后: 由于下级节点为null, 所以进入completeUnitOfWork(unitOfWork)函数, 传入的参数unitOfWork实际上就是workInProgress(此时指向fiber(header)节点)

![](https://7km.top/static/unitofwork4.1.b9d81b55.png)
completeUnitOfWork执行前: workInProgress指针指向fiber(header)节点
completeUnitOfWork执行过程: 以fiber(header)为起点, 向上回溯
第 1 次循环:

执行completeWork函数
创建fiber(header)节点对应的DOM实例, 并append子节点的DOM实例
设置DOM属性, 绑定事件等(本示例中, 节点fiber(header)没有事件绑定)
上移副作用队列: 由于本节点fiber(header)没有副作用(fiber.flags = 0), 所以执行之后副作用队列没有实质变化(目前为空).
向上回溯: 由于还有兄弟节点, 把workInProgress指针指向下一个兄弟节点fiber(`<Content/>`), 退出completeUnitOfWork.

![](https://7km.top/static/unitofwork4.2.e7f971ec.png)
performUnitOfWork第 5 次调用(执行beginWork):
执行前:workInProgress指针指向fiber(`<Content/>`)节点.
执行过程: 这是一个class类型的节点, 与第 2 次调用逻辑一致.
执行后: 返回下级节点fiber(p), 移动workInProgress指针指向子节点fiber(p)
![](https://7km.top/static/unitofwork5.6a117a71.png)

performUnitOfWork第 6 次调用(执行beginWork和completeUnitOfWork):与第 4 次调用中创建fiber(header)节点的逻辑一致. 先后会执行beginWork和completeUnitOfWork, 最后构造 DOM 实例, 并将把workInProgress指针指向下一个兄弟节点fiber(p).

![](https://7km.top/static/unitofwork6.5e595f8a.png)
performUnitOfWork第 7 次调用(执行beginWork和completeUnitOfWork):
beginWork执行过程: 与上次调用中创建fiber(p)节点的逻辑一致
completeUnitOfWork执行过程: 以fiber(p)为起点, 向上回溯
第 1 次循环:

执行completeWork函数: 创建fiber(p)节点对应的DOM实例, 并append子树节点的DOM实例
上移副作用队列: 由于本节点fiber(p)没有副作用, 所以执行之后副作用队列没有实质变化(目前为空).
向上回溯: 由于没有兄弟节点, 把workInProgress指针指向父节点fiber(`<Content/>`)

![](https://7km.top/static/unitofwork7.c44d2d4d.png)
第 2 次循环:

执行completeWork函数: class 类型的节点不做处理
上移副作用队列:
本节点fiber(`<Content/>`)的flags标志位有改动(completedWork.flags > PerformedWork), 将本节点添加到父节点(fiber(div))的副作用队列之后(firstEffect和lastEffect属性分别指向副作用队列的首部和尾部).
向上回溯: 把workInProgress指针指向父节点fiber(div)
![](https://7km.top/static/unitofwork7.1.9ab1933f.png)

第 3 次循环:

执行completeWork函数: 创建fiber(div)节点对应的DOM实例, 并append子树节点的DOM实例
上移副作用队列:
本节点fiber(div)的副作用队列不为空, 将其拼接到父节点fiber `<App/>`的副作用队列后面.
向上回溯: 把workInProgress指针指向父节点fiber(`<App/>`)

![](https://7km.top/static/unitofwork7.2.ceb09595.png)
第 4 次循环:

执行completeWork函数: class 类型的节点不做处理
上移副作用队列:
本节点fiber(`<App/>`)的副作用队列不为空, 将其拼接到父节点fiber(HostRootFiber)的副作用队列上.
本节点fiber(`<App/>`)的flags标志位有改动(completedWork.flags > PerformedWork), 将本节点添加到父节点fiber(HostRootFiber)的副作用队列之后.
最后队列的顺序是子节点在前, 本节点在后
向上回溯: 把workInProgress指针指向父节点fiber(HostRootFiber)

![](https://7km.top/static/unitofwork7.3.6620cf39.png)
第 5 次循环:

执行completeWork函数: 对于HostRoot类型的节点, 初次构造时设置workInProgress.flags |= Snapshot
向上回溯: 由于父节点为空, 无需进入处理副作用队列的逻辑. 最后设置workInProgress=null, 并退出completeUnitOfWork
![](https://7km.top/static/unitofwork7.4.e88061c1.png)

到此整个fiber树构造循环已经执行完毕, 拥有一棵完整的fiber树, 并且在fiber树的根节点上挂载了副作用队列, 副作用队列的顺序是层级越深子节点越靠前.
renderRootSync函数退出之前, 会重置workInProgressRoot = null, 表明没有正在进行中的render. 且把最新的fiber树挂载到fiberRoot.finishedWork上. 这时整个 fiber 树的内存结构如下(注意fiberRoot.finishedWork和fiberRoot.current指针,在commitRoot阶段会进行处理):

### 对比更新

> `react`应用启动后, 界面已经渲染. 如果再次发生更新, 创建 `新fiber`之前需要和 `旧fiber`进行对比. 最后构造的 fiber 树有可能是全新的, 也可能是部分更新的.

三种主动更新的方式

1. `Class`组件中调用 `setState`.
2. `Function`组件中调用 `hook`对象暴露出的 `dispatchAction`.
3. 在 `container`节点上重复调用 `render`

#### setState

```javascript
//class components setState源码
Component.prototype.setState = function (partialState, callback) {
  this.updater.enqueueSetState(this, partialState, callback, 'setState');
};

//updater源码
const classComponentUpdater = {
  isMounted,
  enqueueSetState(inst, payload, callback) {
    // 1. 获取class实例对应的fiber节点
    const fiber = getInstance(inst);
    // 2. 创建update对象
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber); // 确定当前update对象的优先级
    const update = createUpdate(eventTime, lane);
    update.payload = payload;
    if (callback !== undefined && callback !== null) {
      update.callback = callback;
    }
    // 3. 将update对象添加到当前Fiber节点的updateQueue队列当中
    enqueueUpdate(fiber, update);
    // 4. 进入reconciler运作流程中的`输入`环节
    scheduleUpdateOnFiber(fiber, lane, eventTime); // 传入的lane是update优先级
  },
};
```

#### 构造阶段

```javascript
// ...省略部分代码
export function scheduleUpdateOnFiber(
  fiber: Fiber, // fiber表示被更新的节点
  lane: Lane, // lane表示update优先级
  eventTime: number,
) {
  const root = markUpdateLaneFromFiberToRoot(fiber, lane);
  if (lane === SyncLane) {
    if (
      (executionContext & LegacyUnbatchedContext) !== NoContext &&
      (executionContext & (RenderContext | CommitContext)) === NoContext
    ) {
      // 初次渲染
      performSyncWorkOnRoot(root);
    } else {
      // 对比更新
      ensureRootIsScheduled(root, eventTime);
    }
  }
  mostRecentlyUpdatedRoot = root;
}
```
![](https://7km.top/static/fibertree-beforecommit.245f5558.png)
## 渲染与提交阶段


## reconciliation 调和

## 函数组件

## Hooks

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

创建更新：当一个状态更新被触发时（例如，通过 setState），React 会创建一个新的更新，并将其添加到对应组件的更新队列中。

调度更新：React 会根据更新的优先级和当前时间，计划一个新的渲染任务。这个任务会在浏览器的空闲时间执行。

开始工作循环：在浏览器的空闲时间，React 会开始一个工作循环。在这个循环中，React 会遍历 Fiber 树，找到需要更新的 Fiber 节点，并生成一个新的 Fiber 树。

释放控制权：如果在执行工作循环的过程中，浏览器的空闲时间用完了，那么 React 会释放控制权，让浏览器有机会执行其他任务。然后，当浏览器再次有空闲时间时，React 会继续执行工作循环。

提交更新：当新的 Fiber 树准备好后，React 会将其提交到 DOM。这会导致浏览器重新渲染 UI。

每一次 `while`循环的退出就是一个时间切片, 深入分析 `while`循环的退出条件:

1. 队列被完全清空: 这种情况就是很正常的情况, 一气呵成, 没有遇到任何阻碍.
2. 执行超时: 在消费 `taskQueue`时, 在执行 `task.callback`之前, 都会检测是否超时, 所以超时检测是以 `task`为单位.
   * 如果某个 `task.callback`执行时间太长(如: `fiber树`很大, 或逻辑很重)也会造成超时
   * 所以在执行 `task.callback`过程中, 也需要一种机制检测是否超时, 如果超时了就立刻暂停 `task.callback`的执行.

#### 时间切片原理

消费任务队列的过程中, 可以消费 `1~n`个 task, 甚至清空整个 queue. 但是在每一次具体执行 `task.callback`之前都要进行超时检测, 如果超时可以立即退出循环并等待下一次调用.

#### 可中断渲染原理

在时间切片的基础之上, 如果单个 `task.callback`执行时间就很长(假设 200ms). 就需要 `task.callback`自己能够检测是否超时, 所以在 fiber 树构造过程中, 每构造完成一个单元, 都会检测一次超时([源码链接](https://github.com/facebook/react/blob/v17.0.2/packages/react-reconciler/src/ReactFiberWorkLoop.old.js#L1637-L1639)), 如遇超时就退出 `fiber树构造循环`, 并返回一个新的回调函数(就是此处的 `continuationCallback`)并等待下一次回调继续未完成的 `fiber树构造`.

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

### React Hydration是什么，有什么作用，是如何实现的?

A: React Hydration 是 React 在服务器端渲染（SSR）中的一个重要概念。它的主要作用是在客户端接管（或 "激活"）服务器渲染的 HTML。

在服务器端渲染（SSR）中，React 组件会被渲染成字符串形式的 HTML，然后发送到客户端。然而，这些 HTML 是静态的，无法响应用户交互。为了让这些 HTML 变得可以交互，React 提供了一个过程叫做 "hydration"。在 hydration 过程中，React 会遍历服务器渲染的 HTML，为每个 HTML 元素创建对应的 React 组件实例，并添加事件监听器，使得这些 HTML 变得可以响应用户交互。这个过程通常在页面首次加载完成后进行，由 `ReactDOM.hydrate` 函数触发。`ReactDOM.hydrate` 函数的使用方式与 `ReactDOM.render` 函数类似，都是接受一个 React 元素和一个 DOM 容器作为参数。但是，`ReactDOM.hydrate` 函数会假设 DOM 容器中的内容是由服务器渲染的 HTML，并尝试复用这些 HTML，而不是重新渲染。

```javascript
ReactDOM.hydrate(<App />, document.getElementById("root"));
```

#### React 源码中，react-reconciler是如何实现调度的？

> A:
>
> 1. **接收更新** ：当一个组件需要更新（例如，由于状态变化或接收到新的 props）时，React 会在这个组件的 Fiber 节点上调度一个更新。这通常通过 `scheduleUpdateOnFiber` 函数完成。
> 2. **安排工作** ：React 会根据更新的优先级（在 React 中，这被称为 "lane"）来决定何时处理这个更新。优先级高的更新会被优先处理，优先级低的更新可能会被推迟。这通常通过 `ensureRootIsScheduled` 和 `scheduleUpdateOnFiber` 函数完成。
> 3. **开始工作循环** ：当有待处理的更新时，React 会开始一个新的工作循环。在工作循环中，React 会遍历 Fiber 树，找到需要更新的 Fiber 节点，并生成一个新的 Fiber 树。这通常通过 `performUnitOfWork` 和 `workLoop` 函数完成。
> 4. **提交更新** ：当新的 Fiber 树准备好后，React 会将其提交到 DOM。这会导致浏览器重新渲染 UI。这通常通过 `commitRoot` 函数完成。

#### markContainerAsRoot是如何将dom与fiber关联起来

> A：
>
> `markContainerAsRoot` 是 React 的内部函数，它的主要作用是将一个 DOM 容器（通常是你的 React 应用的根 DOM 节点）和一个 FiberRoot 对象关联起来。这个函数在 React 的源码中的实现如下：
>
> ```javascript
> function markContainerAsRoot(hostRoot, node) {
>   node[internalContainerInstanceKey] = hostRoot;
> }
> ```
>
> 在这段代码中，`hostRoot` 是一个 FiberRoot 对象，`node` 是一个 DOM 容器。`internalContainerInstanceKey` 是一个特殊的 key，它在 React 的源码中被定义为一个 Symbol。
>
> 这个函数将 FiberRoot 对象 `hostRoot` 存储在 DOM 容器 `node` 的 `internalContainerInstanceKey` 属性中。这样，我们就可以通过 DOM 容器获取到对应的 FiberRoot 对象。

#### React的可中断渲染是如何实现的？

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

#### React中栈帧是什么，有什么作用？

在 React 中，"栈帧" 是 Fiber 架构中的一个概念。每个 Fiber 对象可以被看作是一个栈帧。当 React 在执行组件的渲染函数或生命周期方法时，它会创建一个新的 Fiber 对象，这个对象包含了当前执行上下文的信息，如当前的 props、state、context 等。

栈帧在 React 中的主要作用如下：

1. **保存状态** ：每个 Fiber 对象都有一个 `memoizedState` 属性，这个属性用于保存组件的 state。当组件状态更新时，React 会创建一个新的 Fiber 对象，并更新其 `memoizedState` 属性。
2. **保存上下文** ：每个 Fiber 对象都有一个 `contextDependencies` 属性，这个属性用于保存组件的 context 依赖。当 context 更新时，React 会遍历 Fiber 树，找到所有依赖该 context 的 Fiber 对象，并将它们标记为需要更新。
3. **支持时间切片和并发模式** ：由于每个 Fiber 对象都是一个独立的栈帧，React 可以在执行过程中暂停和恢复任何 Fiber 对象。这使得 React 可以实现时间切片和并发模式。
4. **支持 Hooks** ：每个 Fiber 对象都有一个 `memoizedState` 和 `updateQueue` 属性，这些属性用于保存 Hooks 的状态和更新。当组件使用 Hooks 时，React 会将 Hooks 的状态和更新保存在 Fiber 对象中。
