import { configRead } from './config';

function setTime(show) {

    if (!show) {
        const watch = document.querySelector('.webOs-watch');
        if (watch) {
            watch.remove();
        }
        return;
    }

    const watch = document.createElement('div');
    watch.innerHTML = `<div class="webOs-watch"></div>`;
    const style = document.createElement('style');

    style.textContent =
        `.webOs-watch {
        position: fixed;
        right: 0;
        top: 0;
        margin: 1rem 2rem;
        background-color: rgba(0, 0, 0, 0.2);
        border-radius: 0.5rem;
        padding: 0.4rem;
        font-size: 1.2rem;
    }`;
    document.head.appendChild(style);
    document.body.appendChild(watch);

    setInterval(() => {
        const time = new Date();
        let minutes = time.getMinutes().toString();
        let houres = time.getHours().toString();
        minutes = minutes.length < 2 ? '0' + minutes : minutes;
        houres = houres.length < 2 ? '0' + houres : houres;
        try {

            const text = houres + ' : ' + minutes;
            document.querySelector('.webOs-watch').innerText = text;

            const watchDefault = document.querySelector('ytlr-watch-default');
            const watchControls = document.querySelector('ytlr-watch-metadata');
            const webOsWatch = document.querySelector('.webOs-watch');

            if (watchDefault && watchDefault.clientHeight > 0 && !(watchControls && window.getComputedStyle(watchControls).display !== 'none')) {
                webOsWatch.style.display = 'none';
            } else {
                webOsWatch.style.display = '';
            }

        } catch (e) {
            document.querySelector('.webOs-watch').innerText = `Error`;
        }

    }, 500);
};

setTime(configRead('showWatch'));

configAddChangeListener('showWatch', (evt) => {
    setTime(evt.detail.newValue);
});

