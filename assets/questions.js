"use strict";
(() => {
  for (const question of document.querySelectorAll("[data-question]")) {
    const options = [...question.querySelectorAll("[data-choice]")];
    const feedback = question.querySelector("[data-feedback]");
    const response = question.querySelector("[data-choice-response]");
    const retry = question.querySelector("[data-retry]");
    for (const option of options) {
      option.addEventListener("click", () => {
        for (const other of options) other.setAttribute("aria-pressed", String(other === option));
        const selected = Number(option.dataset.choice);
        const custom = question.getAttribute("data-response-" + selected);
        response.textContent = custom || "";
        response.hidden = !custom;
        feedback.hidden = false;
        retry.hidden = false;
      });
    }
    retry.addEventListener("click", () => {
      for (const option of options) option.setAttribute("aria-pressed", "false");
      feedback.hidden = true;
      retry.hidden = true;
      response.textContent = "";
      options[0].focus();
    });
  }
})();
