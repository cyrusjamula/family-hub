import {BUILD_VERSION} from './build-version.js';
const valid=value=>typeof value==='string'&&/^[a-f0-9]{7,40}$/.test(value);
export function releaseFor(env,build=BUILD_VERSION){return valid(build)?build:valid(env.TELEMETRY_RELEASE)?env.TELEMETRY_RELEASE:'unknown';}
