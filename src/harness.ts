import { IOStackClient } from './client.js';
import { ClientInterface, StreamFragmentPacket } from './client.interface.js';
import readline from 'readline';

export class Harness {

    private rl: any;
    private client: ClientInterface|undefined = undefined;

    constructor(private access_key: string, private platform_root?: string) {

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

    }

    public async interactWithAgent(): Promise<void> {

        if(this.client) {
            throw new Error("Session already in progress")
        }

        this.client = IOStackClient.newClient({
            access_key: this.access_key,
            streamFragmentHandlers: [this.streamFragmentHandler],
            errorHandlers: [this.errorHandler],
            platform_root: this.platform_root
        })

        try {

            await this.client.startSession()

            while(true) {
                const message = await this.input('Enter message: ');
                await this.client.sendMessage(message)
            }

        } catch(e) {
            console.error(e)
        } finally {
            this.client.deregisterAllHandlers()
        }

    }

    private async input(prompt: string): Promise<string> {
        return new Promise(r => this.rl.question(prompt, r));
    }

    private async streamFragmentHandler(fragment: StreamFragmentPacket): Promise<void> {
        process.stdout.write(`${fragment.fragment}${fragment.final ? "\n" : ""}`);
    }
    
    private async errorHandler(error: string) {
        console.error(error)
    }
    

}