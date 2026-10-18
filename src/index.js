import { extractLaunchParams, handleLaunch } from './utils';
import { waitForNetwork } from './wait-for-network';

async function main() {
  let params = extractLaunchParams();

  document.addEventListener(
    'webOSRelaunch',
    (evt) => {
      params = evt.detail;
    },
    true
  );

  await waitForNetwork();
  handleLaunch(params);
}

main();
