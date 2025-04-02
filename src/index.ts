import { Harness } from './harness.js';

const harness = new Harness(
    "iosk-ucst-..."         // Insert your access key here
)

await harness.interactWithAgent();

