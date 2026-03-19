# react-from-scratch

A minimal React-like rendering engine built from scratch in vanilla JavaScript. This project re-implements React's core internals — virtual DOM, fiber architecture, a cooperative scheduler, a reconciler, and `useState` — without any external dependencies.

---

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
  - [1. Virtual DOM](#1-virtual-dom)
  - [2. Fiber Architecture](#2-fiber-architecture)
  - [3. Scheduler](#3-scheduler)
  - [4. Reconciliation](#4-reconciliation)
  - [5. Commit Phase](#5-commit-phase)
  - [6. useState Hook](#6-usestate-hook)
  - [7. The `html` Helper](#7-the-html-helper)
- [Complete Render Flow](#complete-render-flow)
- [Getting Started](#getting-started)
- [Usage Example](#usage-example)
- [Key Design Decisions](#key-design-decisions)
- [Limitations](#limitations)

---

## Overview

React's internals are notoriously complex. This project strips them down to their essence, implementing just enough to support:

- Functional components
- The fiber tree work loop
- DOM creation and updates
- Diffing and reconciliation (add, update, delete)
- The `useState` hook with re-render triggering

---

## Project Structure

```
react-from-scratch/
├── index.html        # Entry point — mounts the app to #root
├── src/
│   ├── engine.js     # The core engine: VDOM, fiber, scheduler, reconciler, hooks
│   └── main.js       # Application code — your components live here
├── package.json
└── vite.config.js    # (optional) Vite dev server config
```

---

## How It Works

### 1. Virtual DOM

Before touching the real DOM, the engine builds a lightweight JavaScript object tree that describes what the UI should look like.

**`createTextElement(text)`** — wraps a plain string into a virtual node:

```js
{ type: "TEXT_ELEMENT", props: { nodeValue: "hello", children: [] } }
```

**`createElement(type, props, ...children)`** — creates a virtual node for any HTML tag or component function. Children are recursively normalized — strings become text elements, nested arrays are flattened.

```js
createElement("div", null, createElement("h1", null, "Hello"));
```

This is equivalent to what Babel compiles JSX into (`React.createElement`).

---

### 2. Fiber Architecture

Each virtual DOM node becomes a **fiber** — a plain JS object that holds everything the engine needs to do its work:

```js
{
  type,        // HTML tag string or function component
  props,       // Props including children
  dom,         // Reference to the real DOM node (if created)
  parent,      // Parent fiber
  child,       // First child fiber
  sibling,     // Next sibling fiber
  alternate,   // Pointer to the fiber from the previous render (for diffing)
  effectTag,   // What to do: "PLACEMENT" | "UPDATE" | "DELETION"
  hooks,       // Array of hook state (for functional components)
}
```

Fibers are linked in three directions — parent, child, and sibling — forming a tree that can be traversed iteratively without a call stack.

**`render(element, container)`** kicks everything off by creating the root fiber (`wipRoot`) and setting it as the first unit of work:

```js
wipRoot = {
  dom: container,
  props: { children: [element] },
  alternate: currentRoot,
};
nextUnitOfWork = wipRoot;
```

---

### 3. Scheduler

React doesn't process the entire fiber tree in one go — that would block the browser and cause jank. Instead, it breaks work into small units and yields back to the browser between them.

**`workLoop(deadline)`** runs via `requestIdleCallback`, which the browser calls whenever the main thread is idle. It processes one fiber at a time and checks if time is running out:

```js
while (nextUnitOfWork && !shouldYield) {
  nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  shouldYield = deadline.timeRemaining() < 1;
}
```

If all units of work are done (`nextUnitOfWork` is null) and there's a pending work-in-progress root, it flushes the changes to the real DOM via `commitRoot()`.

---

### 4. Reconciliation

**`performUnitOfWork(fiber)`** processes a single fiber. It delegates to one of two strategies:

- **`updateHostComponent(fiber)`** — for plain HTML elements. Creates a real DOM node if one doesn't exist yet, then reconciles children.
- **`updateFunctionalComponent(fiber)`** — for function components. Calls the function to get its rendered output, sets up the hook context (`wipFiber`, `hookIndex`), then reconciles the returned children.

**`reconcileChildren(wipFiber, elements)`** is the diffing algorithm. It walks the new elements alongside the old fiber children (via `alternate.child` / `alternate.sibling`) and decides what to do with each:

| Situation                 | Action                       | Effect Tag  |
| ------------------------- | ---------------------------- | ----------- |
| Same type, both exist     | Reuse DOM node, update props | `UPDATE`    |
| New element, no old fiber | Create new DOM node          | `PLACEMENT` |
| Old fiber, no new element | Remove from DOM              | `DELETION`  |

Deletions are collected in a separate `deletions` array because they have no corresponding new fiber to attach to.

After reconciling, the fiber returns the next unit of work using a depth-first traversal: child first, then sibling, then parent's sibling.

---

### 5. Commit Phase

Once all fibers are processed, the engine commits the entire new tree to the real DOM in a single synchronous pass — so the user never sees a partially rendered UI.

**`commitRoot()`**:

1. Processes the `deletions` array first (removes old nodes)
2. Walks the new fiber tree via `commitWork(wipRoot.child)`
3. Saves the committed tree as `currentRoot` (used as `alternate` in the next render)

**`commitWork(fiber)`** handles each fiber according to its `effectTag`:

- `PLACEMENT` → `domParent.appendChild(fiber.dom)`
- `UPDATE` → calls `updatedDom()` to patch props in place
- `DELETION` → calls `commitDeletion()`, which recurses into children if the fiber has no DOM node (i.e., it's a functional component)

**`updatedDom(dom, prevProps, nextProps)`** clears all old props and applies new ones, including event handlers (`onclick`, `onchange`, etc.).

---

### 6. useState Hook

`useState` is the only hook implemented. It follows the same rules-of-hooks pattern React uses: hook state is stored as an array on the fiber, and the current index is tracked globally as `hookIndex`.

```js
export function useState(initial) {
  const oldHook = wipFiber.alternate?.hooks?.[hookIndex];

  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [], // Actions dispatched since last render
  };

  // Replay all dispatched actions to compute latest state
  (oldHook ? oldHook.queue : []).forEach((action) => {
    hook.state = typeof action === "function" ? action(hook.state) : action;
  });

  const setState = (action) => {
    hook.queue.push(action);
    // Schedule a re-render by creating a new wipRoot
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  hookIndex++;

  return [hook.state, setState];
}
```

Calling `setState` doesn't immediately update state — it pushes an action into the hook's queue and schedules a re-render. On the next render pass, all queued actions are replayed in order to compute the new state.

---

### 7. The `html` Helper

Writing raw `createElement` calls is verbose. The `html()` helper accepts a nested JS object and translates it into `createElement` calls:

```js
html({
  div: {
    prop: null,
    children: [{ h1: { prop: null, children: ["Hello"] } }],
  },
});

// is equivalent to:
createElement("div", null, createElement("h1", null, "Hello"));
```

This gives a JSX-like authoring experience with no build tooling required.

---

## Complete Render Flow

```
render(element, container)
        │
        ▼
  Create wipRoot fiber
  Set nextUnitOfWork = wipRoot
        │
        ▼
  requestIdleCallback → workLoop()
        │
        ├─── performUnitOfWork(fiber)
        │         │
        │         ├── updateHostComponent()    ← plain HTML tags
        │         │       └── reconcileChildren()
        │         │
        │         └── updateFunctionalComponent()  ← function components
        │                 ├── call fiber.type(props)  → runs your component
        │                 └── reconcileChildren()
        │
        │    [repeat for each fiber until tree is fully processed]
        │
        ▼
  commitRoot()
        ├── process deletions
        └── commitWork(fiber)  → patch real DOM
              ├── PLACEMENT  → appendChild
              ├── UPDATE     → updatedDom
              └── DELETION   → removeChild
```

---

## Getting Started

**Prerequisites:** Node.js 16+

```bash
# Clone the repo
git clone https://github.com/Goku1-Dev/react-from-scratch.git
cd react-from-scratch

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Usage Example

```js
import { createElement, html, render, useState } from "./engine.js";

function Counter() {
  const [count, setCount] = useState(0);

  return html({
    div: {
      prop: null,
      children: [
        { h1: { prop: null, children: ["Count: ", count] } },
        {
          button: {
            prop: { onclick: () => setCount((c) => c + 1) },
            children: ["Increment"],
          },
        },
      ],
    },
  });
}

const container = document.getElementById("root");
render(createElement(Counter, null), container);
```

---

## Key Design Decisions

| Decision                                    | Reason                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `requestIdleCallback` for scheduling        | Yields to the browser between fiber units, preventing UI jank                 |
| Separate work-in-progress and current trees | Allows the render to be interrupted without corrupting the live UI            |
| `alternate` pointer on each fiber           | Enables diffing against the previous render without a separate data structure |
| `deletions` array                           | Deleted fibers have no place in the new tree, so they're tracked separately   |
| Hook state stored on fibers                 | Ties state lifetime to component identity, just like React                    |

---

## Limitations

- No JSX support (use the `html()` helper instead)
- Event listeners are set as direct DOM properties (`onclick`) — no `addEventListener` or event delegation
- Only `useState` is implemented — no `useEffect`, `useRef`, `useMemo`, etc.
- No error boundaries or suspense
- No keys support in lists — reconciliation relies solely on position
- `requestIdleCallback` is not available in all environments (not supported in Safari without a polyfill)
