"use strict";
const menu=document.querySelector(".menu-toggle");
menu?.addEventListener("click",()=>{const nav=document.getElementById("lesson-nav");const open=nav.classList.toggle("open");menu.setAttribute("aria-expanded",String(open));});
