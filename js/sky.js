(function () {
  'use strict';
  var sky = document.querySelector('.sky-effects');
  var trails = sky && sky.querySelector('.shooting-stars');
  if (!trails || !window.matchMedia || !window.Element.prototype.animate) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var timer = null;
  var trajectoryAngle = Math.PI / 6;
  var trajectorySlope = Math.tan(trajectoryAngle);

  function randomBetween(min, max) { return min + Math.random() * (max - min); }

  function schedule() {
    if (!reducedMotion.matches) timer = window.setTimeout(launch, Math.random() * 10000);
  }

  function launch() {
    timer = null;
    if (reducedMotion.matches) return;

    var width = window.innerWidth, height = window.innerHeight;
    var padding = randomBetween(16, 64);
    var startYMax = Math.max(0, height - (width + padding * 2) * trajectorySlope);
    var startY = startYMax ? randomBetween(0, startYMax) : randomBetween(0, Math.min(height * 0.2, 120));
    var start = { x: width + padding, y: startY };
    var travelX = Math.min(start.x + padding, (height + padding - start.y) / trajectorySlope);
    var end = { x: start.x - travelX, y: start.y + travelX * trajectorySlope };
    var meteor = document.createElement('i');
    meteor.className = 'shooting-star';
    meteor.style.left = start.x + 'px';
    meteor.style.top = start.y + 'px';
    meteor.style.width = randomBetween(48, 148) + 'px';
    meteor.style.setProperty('--head', randomBetween(3, 7) + 'px');
    meteor.style.transform = 'rotate(' + (-trajectoryAngle * 180 / Math.PI) + 'deg)';
    trails.appendChild(meteor);

    var animation = meteor.animate([
      { left: start.x + 'px', top: start.y + 'px', opacity: 0, offset: 0 },
      { left: start.x - travelX * 0.07 + 'px', top: start.y + travelX * trajectorySlope * 0.07 + 'px', opacity: 0.95, offset: 0.07 },
      { left: end.x + 'px', top: end.y + 'px', opacity: 0.7, offset: 0.82 },
      { left: end.x + 'px', top: end.y + 'px', opacity: 0, offset: 1 }
    ], { duration: randomBetween(900, 3200), easing: 'linear' });
    animation.onfinish = function () { meteor.remove(); };
    schedule();
  }

  reducedMotion.addEventListener('change', function () {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (reducedMotion.matches) {
      trails.querySelectorAll('.shooting-star').forEach(function (meteor) {
        meteor.getAnimations().forEach(function (animation) { animation.cancel(); });
        meteor.remove();
      });
    } else schedule();
  });

  schedule();
})();