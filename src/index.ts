

import { Harness } from './harness.js';


const harness = new Harness(
    "iosk-ucst-prd-6ZqJaCj5vBuqBvTJsZUvLww8tRVCk4vUTwVPF26tjezu6EdU8HZIHKzqnhlLxbuxb3UkjmEZeCkbneTXj1jIztu1aMA4lPfyggY7pSsVDIq8BLA0Jz7hCVZ1loQDQO7iCPfQJq5irESN0U6Y43R2THTAEM1v",
    "http://localhost:8000"
)

await harness.interactWithAgent();

