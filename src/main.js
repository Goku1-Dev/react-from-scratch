import { createElement, html, render, useState, useEffect } from "./engine.js";

function Counter() {
  const [toggleText, setToggleText] = useState(true);

  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log("Effect: count changed to", count);
    const timer = setInterval(() => {
      console.log("Tick for count:", count);
    }, 1000);

    return () => {
      console.log("Cleanup for count:", count);
      clearInterval(timer);
    };
  }, [count]);

  return html({
    div: {
      prop: null,
      children: [
        {
          h1: {
            prop: null,
            children: ["counter: ", count],
          },
        },
        {
          button: {
            prop: { onclick: () => setCount((c) => c + 1) },
            children: ["counter"],
          },
        },
        {
          p: {
            prop: null,
            children: [toggleText ? "hello" : "world"],
          },
        },
        {
          button: {
            prop: { onclick: () => setToggleText(!toggleText) },
            children: ["toggle"],
          },
        },
      ],
    },
  });
}

const container = document.getElementById("root");
render(createElement(Counter, null), container);
