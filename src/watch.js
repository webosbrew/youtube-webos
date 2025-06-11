import { configRead, configAddChangeListener } from './config';
import './watch.css';

function setTime(show) {
  if (!show) {
    const watch = document.querySelector('.webOs-watch');
    if (watch) {
      watch.remove();
    }
    return;
  }

  const watch = document.createElement('div');
  watch.innerHTML = '<div class="webOs-watch"></div>';
  document.body.appendChild(watch);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'YT-LR-WATCH-DEFAULT') {
            watch.style.display = 'none';
          }
        });
      } else if (mutation.type === 'attributes') {
        if (mutation.target.nodeName === 'YTLR-WATCH-DEFAULT') {
          watch.style.display = mutation.target.clientHeight > 0 ? 'none' : '';
        } else if (mutation.target.nodeName === 'YTLR-WATCH-METADATA') {
          watch.style.display =
            window.getComputedStyle(mutation.target).display == 'none'
              ? 'none'
              : '';
        }
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true
  });

  const nextSeg = 1000 - new Date().getMilliseconds();

  const setTime = () => {
    window.requestAnimationFrame(() => {
      document.querySelector('.webOs-watch').innerText =
        new Intl.DateTimeFormat(navigator.language, {
          hour: 'numeric',
          minute: 'numeric'
        }).format(new Date());
    });
  };

  setTimeout(() => {
    setTime();
    setInterval(setTime, 60000);
  }, nextSeg);
}

setTime(configRead('showWatch'));

configAddChangeListener('showWatch', (evt) => {
  setTime(evt.detail.newValue);
});
