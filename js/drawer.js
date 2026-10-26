/*
 * drawer.js
 * The slide-in side pane. Any button with data-drawer="template-id" opens it; the named <template> in
 * index.html e.g. "Build details"
 *
 * The page behind is never resized or re-laid out while the pane is open. (Locking it with overflow: hidden,
 * as before, made iPhones shift the page and replay the scroll effects on close: a zoom out and back in.)
 * Instead, scrolling over the dimmed backdrop is cancelled, the pane's own scrolling never spills onto the page,
 * and closing returns to the exact scroll position and the button that opened it.
 */
(function () {
  "use strict";

  const root = document.documentElement;
  const drawer = document.getElementById("drawer");
  const drawerBody = document.getElementById("drawer-body");
  const scrollArea = drawer.querySelector(".drawer-scroll-area");

  let openedFrom = null;      // the button that opened the pane
  let pageScrollY = 0;        // where the page was when it opened
  let touchStartY = 0;

  function openDrawer(trigger) {
    const template = document.getElementById(trigger.getAttribute("data-drawer"));
    if (!template) {
      return;
    }
    drawerBody.replaceChildren(template.content.cloneNode(true));
    openedFrom = trigger;
    pageScrollY = window.scrollY;
    if (typeof drawer.showModal === "function") {
      drawer.showModal();
    } else {
      drawer.setAttribute("open", "");
    }
    root.classList.add("is-drawer-open");
    setPageScrollBlocked(true);
    scrollArea.scrollTop = 0;
  }

  document.querySelectorAll("[data-drawer]").forEach((trigger) => {
    trigger.addEventListener("click", () => openDrawer(trigger));
  });

  document.getElementById("drawer-close").addEventListener("click", () => { drawer.close(); });

  drawer.addEventListener("close", () => {
    root.classList.remove("is-drawer-open");
    setPageScrollBlocked(false);
    if (Math.abs(window.scrollY - pageScrollY) > 1) {
      window.scrollTo({ top: pageScrollY, behavior: "instant" });
    }
    if (openedFrom) {
      openedFrom.focus({ preventScroll: true });
    }
  });

  // Clicking the dimmed backdrop closes it.
  drawer.addEventListener("click", (event) => {
    const drawerBox = drawer.getBoundingClientRect();
    const clickedOutside = event.clientX < drawerBox.left || event.clientX > drawerBox.right
      || event.clientY < drawerBox.top || event.clientY > drawerBox.bottom;
    if (clickedOutside) {
      drawer.close();
    }
  });

  // True when a scroll gesture would move the page behind: it's over the backdrop, or the pane is already
  // at its top or bottom in that direction.
  function wouldScrollPage(event, downward) {
    if (!scrollArea.contains(event.target)) {
      return true;
    }
    const atTop = scrollArea.scrollTop <= 0;
    const atBottom = scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 1;
    return downward ? atBottom : atTop;
  }

  // Listened for on the whole window while the pane is open: over the backdrop, browsers send these events to the
  // page behind (which the open dialog makes inert) rather than to the dialog itself.
  function blockWheel(event) {
    if (wouldScrollPage(event, event.deltaY > 0)) {
      event.preventDefault();
    }
  }

  function rememberTouch(event) {
    touchStartY = event.touches[0] ? event.touches[0].clientY : 0;
  }

  function blockTouchScroll(event) {
    const touch = event.touches[0];
    if (touch && wouldScrollPage(event, touch.clientY < touchStartY)) {
      event.preventDefault();
    }
  }

  function blockScrollKeys(event) {
    const scrollKeys = [" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"];
    if (scrollKeys.includes(event.key) && !scrollArea.contains(event.target)) {
      event.preventDefault();
    }
  }

  function setPageScrollBlocked(isBlocked) {
    const method = isBlocked ? "addEventListener" : "removeEventListener";
    window[method]("wheel", blockWheel, { passive: false });
    window[method]("touchstart", rememberTouch, { passive: true });
    window[method]("touchmove", blockTouchScroll, { passive: false });
    window[method]("keydown", blockScrollKeys);
  }
})();
