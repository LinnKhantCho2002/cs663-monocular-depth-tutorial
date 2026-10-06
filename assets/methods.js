"use strict";
(() => {
  const demo = document.getElementById("loss-demo");
  if (!demo) return;
  const scale = demo.querySelector("#loss-scale");
  const shift = demo.querySelector("#loss-shift");
  const edge = demo.querySelector("#loss-edge");
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  function normalize(values) {
    const center = mean(values);
    const spread = mean(values.map(value => Math.abs(value - center)));
    return values.map(value => (value - center) / Math.max(spread, 1e-6));
  }
  function update() {
    const a = Number(scale.value), b = Number(shift.value), e = Number(edge.value);
    const anchor = [1, 2, 3];
    const student = anchor.map((value, index) => a * value + b + (index === 2 ? e : 0));
    const normalizedAnchor = normalize(anchor), normalizedStudent = normalize(student);
    demo.querySelector("#loss-scale-value").textContent = a.toFixed(2);
    demo.querySelector("#loss-shift-value").textContent = b.toFixed(2);
    demo.querySelector("#loss-edge-value").textContent = e.toFixed(2);
    demo.querySelector("#loss-values").textContent = "[" + student.map(v => v.toFixed(2)).join(", ") + "]";
    demo.querySelector("#loss-raw").textContent = mean(student.map((v, i) => Math.abs(v - anchor[i]))).toFixed(3);
    demo.querySelector("#loss-normalized").textContent = mean(normalizedStudent.map((v, i) => Math.abs(v - normalizedAnchor[i]))).toFixed(3);
    demo.querySelector("#loss-reading").textContent = e === 0
      ? "Scale and offset changed, but the normalized shape still matches."
      : "The third point changed on its own. Normalization leaves an error in the shape.";
    for (let i = 0; i < 3; i++) {
      demo.querySelector("#loss-bar-" + i).style.height = (20 + (student[i] + 1) * 18) + "px";
      demo.querySelector("#loss-bar-" + i).setAttribute("aria-label", "Student point " + (i + 1) + ": " + student[i].toFixed(2));
    }
  }
  [scale, shift, edge].forEach(input => input.addEventListener("input", update));
  demo.querySelector("[data-loss-reset]").addEventListener("click", () => {
    scale.value = 1; shift.value = 0; edge.value = 0; update();
  });
  update();
})();
