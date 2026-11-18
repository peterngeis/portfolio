/*
 * drawer.js
 * The slide-in side pane. Anything with data-drawer="template-id" opens it, filled from that <template> at the end of
 * index.html: "Build details", the ski winch card, and the keyboard and band phrases in the tinker time line.
 *
 */
(function (Site) {
  "use strict";

  const root = document.documentElement;
  const drawer = document.getElementById("drawer");
  const drawerBody = document.getElementById("drawer-body");
  const scrollArea = drawer.querySelector(".drawer-scroll-area");

  let openedFrom = null;      // the button that opened the pane
  let pageScrollY = 0;        // where the page was when it opened
  let touchStartY = 0;

  /* ---------- Loading a pane's media ahead of time ----------
     The first hover, focus, or press that opens a pane loads its photos into the browser's cache and starts each clip loading in a
     video element kept for that pane. Opening the pane uses those same video elements, so a clip that has started
     loading, or has played before, state is saved. */
  const preparedVideos = new Map();

  function prepareDrawer(templateId) {
    if (preparedVideos.has(templateId)) {
      return preparedVideos.get(templateId);
    }
    const template = document.getElementById(templateId);
    if (!template) {
      return [];
    }
    template.content.querySelectorAll("img").forEach((image) => {
      const photo = new Image();
      photo.src = image.getAttribute("src");
    });
    const videos = Array.from(template.content.querySelectorAll("video")).map((templateVideo) => {
      // importNode, a plain copy still belongs to the template's document, which can't load
      // media, and the clip would fail ("source not supported") and stay broken even after joining the page.
      const video = document.importNode(templateVideo, true);
      video.preload = "auto";
      video.load();
      return video;
    });
    preparedVideos.set(templateId, videos);
    return videos;
  }

  function openDrawer(trigger) {
    const templateId = trigger.getAttribute("data-drawer");
    const template = document.getElementById(templateId);
    if (!template) {
      return;
    }
    // Swap the template clips for loaded, then let js/video.js play them while on screen.
    const content = template.content.cloneNode(true);
    const videos = prepareDrawer(templateId);
    content.querySelectorAll("video").forEach((video, index) => {
      if (videos[index]) {
        video.replaceWith(videos[index]);
      }
    });
    drawerBody.replaceChildren(content);
    if (Site && Site.watchVideo) {
      videos.forEach(Site.watchVideo);
    }
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
    const prepare = () => { prepareDrawer(trigger.getAttribute("data-drawer")); };
    trigger.addEventListener("pointerenter", prepare);
    trigger.addEventListener("focus", prepare);
    trigger.addEventListener("pointerdown", prepare);

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openDrawer(trigger);
    });

    // Links acting as buttons open on Space too
    if (trigger.tagName === "A") {
      trigger.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          event.preventDefault();
          trigger.click();
        }
      });
    }
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
})(window.Site);
