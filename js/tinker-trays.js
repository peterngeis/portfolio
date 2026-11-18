/*
 * tinker-tray.js
 * Hover previews for the phrases in the Tinker time line (screens with a mouse only). Each phrase's data-peek names
 * its preview; hovering floats it beside the cursor, several images crossfade, and the preview takes each image's
 * shape so nothing is cropped. Clicking a phrase opens its side pane (js/drawer.js), which hides the preview.
 */
(function (Site) {
  "use strict";

  const PEEK_STEP = 900;   // milliseconds each image shows in a hover preview

  const triggers = Array.from(document.querySelectorAll(".tinker-trigger"));
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let activePeek = null;
  let peekTimer = 0;

  function hidePeek() {
    if (activePeek) {
      activePeek.classList.remove("is-visible");
      activePeek = null;
    }
    clearInterval(peekTimer);
  }

  // Keeps a preview beside the cursor, above it where there's room, and always on screen.
  function movePeek(peek, event) {
    const width = peek.offsetWidth;
    const height = peek.offsetHeight;
    const x = Math.min(window.innerWidth - width - 12, event.clientX + 18);
    const y = event.clientY - height - 18 > 12 ? event.clientY - height - 18 : event.clientY + 24;
    peek.style.transform = "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
  }

  // Shows one image of a preview, and sizes the preview to that image's shape.
  function showPeekImage(peek, images, index) {
    const image = images[index];
    const ratio = (parseFloat(image.getAttribute("width")) || 16) / (parseFloat(image.getAttribute("height")) || 9);
    peek.style.height = Math.round(peek.offsetWidth / ratio) + "px";
    images.forEach((other, i) => other.classList.toggle("is-shown", i === index));
  }

  if (!canHover) {
    return;
  }

  triggers.forEach((trigger) => {
    const peek = document.getElementById(trigger.getAttribute("data-peek"));
    const images = peek ? Array.from(peek.querySelectorAll("img")) : [];
    if (images.length === 0) {
      return;
    }

    trigger.addEventListener("pointerenter", (event) => {
      hidePeek();
      activePeek = peek;
      let index = 0;
      showPeekImage(peek, images, index);
      movePeek(peek, event);
      peek.classList.add("is-visible");
      if (Site.motionEnabled && images.length > 1) {
        peekTimer = setInterval(() => {
          index = (index + 1) % images.length;
          showPeekImage(peek, images, index);
        }, PEEK_STEP);
      }
    });
    trigger.addEventListener("pointermove", (event) => movePeek(peek, event));
    trigger.addEventListener("pointerleave", hidePeek);
    trigger.addEventListener("click", hidePeek);   // close when opening the side pain
  });
})(window.Site);
