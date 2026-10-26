/*
 * tinker-trays.js
 * Phrases in the Tinker time line open small trays of extra material below the sentence: the keyboard model and
 * the band. Each phrase is a link acting as a button (<a class="tinker-trigger" role="button">, so it wraps across
 * lines like the rest of the sentence) whose aria-controls names its tray and data-peek names
 * its hover preview. 
 * 
 * Opening one tray closes the other. On screens with a mouse, hovering a phrase floats its
 * preview beside the cursor; several images crossfade, and the preview takes each image's shape so nothing is
 * cropped. js/video.js plays the keyboard clip while its tray is on screen.
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

  function setTray(trigger, isOpen) {
    trigger.setAttribute("aria-expanded", String(isOpen));
    const tray = document.getElementById(trigger.getAttribute("aria-controls"));
    if (tray) {
      tray.hidden = !isOpen;
    }
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

  triggers.forEach((trigger) => {
    // Space opens it too, as with any button (Enter already clicks a link).
    trigger.addEventListener("keydown", (event) => {
      if (event.key === " ") {
        event.preventDefault();
        trigger.click();
      }
    });

    trigger.addEventListener("click", (event) => {
      event.preventDefault();   // it opens its tray; it doesn't jump to it
      const isOpening = trigger.getAttribute("aria-expanded") !== "true";
      triggers.forEach((other) => {
        if (other !== trigger && other.getAttribute("aria-expanded") === "true") {
          setTray(other, false);
        }
      });
      setTray(trigger, isOpening);
      hidePeek();
      Site.measureNow();   // everything below just moved
    });

    const peek = document.getElementById(trigger.getAttribute("data-peek"));
    if (!peek || !canHover) {
      return;
    }
    const images = Array.from(peek.querySelectorAll("img"));
    if (images.length === 0) {
      return;
    }

    trigger.addEventListener("pointerenter", (event) => {
      if (trigger.getAttribute("aria-expanded") === "true") {
        return;   // its tray is already open
      }
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
  });
})(window.Site);
