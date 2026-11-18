/*
 * video.js
 * Plays muted, looping clips while they're on screen and pauses them
 * when they scroll away. Reduced motion and autoplay off keeps the play controls.
 *
 * Clips in the page are picked up on load. Clips that arrive later (the side pane's, js/drawer.js) are handed over
 * with Site.watchVideo(video); handing over the same clip again does nothing.
 */
(function (Site) {
  "use strict";

  Site.watchVideo = () => {};   // replaced below when clips may play on their own

  if (!Site.motionEnabled || !("IntersectionObserver" in window)) {
    return;
  }

  const watchedVideos = new WeakSet();
  const visibleVideos = new Set();

  function playIfAllowed(video) {
    if (Site.animationsPaused) {
      return;   // while animations are paused, clips wait
    }
    const playPromise = video.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(() => { video.setAttribute("controls", ""); });
    }
  }

  // One observer for every clip. Inside the side pane, "on screen" means visible within the pane's scrolling area.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      if (entry.isIntersecting) {
        visibleVideos.add(video);
        playIfAllowed(video);
      } else {
        visibleVideos.delete(video);
        video.pause();
      }
    });
  }, { threshold: 0.25 });

  Site.watchVideo = (video) => {
    if (watchedVideos.has(video)) {
      return;
    }
    watchedVideos.add(video);
    video.muted = true;
    video.removeAttribute("controls");
    observer.observe(video);
  };

  document.querySelectorAll("video[data-autoplay]").forEach(Site.watchVideo);

  // Pausing stops every clip; resuming plays the ones on screen.
  Site.onPauseChange((isPaused) => {
    if (isPaused) {
      visibleVideos.forEach((video) => video.pause());
    } else {
      visibleVideos.forEach(playIfAllowed);
    }
  });
})(window.Site);
