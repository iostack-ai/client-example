# iostack Demo Client

This repo provides a reference implementation demonstrating by example how an external application may interact with the iostack Inference API to interact with a pre-authored iostack Agent.

It achieves this by providing code that

1. Wraps the iostack Inference API.
2. Demonstrates the retrieval and use of refresh and access tokens as required by the inference server.
3. Handles de-multiplexing of the event stream returned from an Agent interaction.

## Prerequisites

You will need ```npm``` and ```node``` installed first. 

_NB: this code has only been tested on MacOS - please contact us if you experience issues installing on Windows or Linux._

## Installation Instructions

Follow the following steps:

### 1. Install dependencies.

```
npm install
```

### 2. Configuration

In ```index.ts```, configure a valid iostack access key:

```javascript
...
...
const harness = new Harness(
    "iosk-ucst-...",    // Insert your valid access key for any published iostack Agent here 
)
...
...
```

### 3. Build

```
npm run build
```

### 4. Run

```
npm run start
```
* Repeat this step every time you want to interact with the Agent via the command line. 

* If you make changes to the source, ensure that build the code again before running.


# Notes

### The Harness
---
```harness.ts```

A convenience class with functionality enabling repeated conversation turns with a nominated iostack Agent (as specified by the access key).


### The Client
---
```client.ts```

The ```IOStackClient``` class handles all details of the calling sequence for establishing, conducting and maintaining a conversation session.

It abstracts the idea of a conversation into a session and implements all aspects of interacting with the iostack Inference API and consuming the resultant responses over the lifetime of a session.

All meaningful outputs (text fragments, state update notifications, errors) are passed back to the caller via notification callbacks that need to be pre-registered. See the examples in the ```Harness``` class

The main phases correspond to setup, session initialisation and maintenance and error handling:

#### 1. Initiation of a conversation session
---
* Authorisation
* Parameterisation of the session/conversation with external data as required by the authored Agent 
* Retrieving and maintaining valid refresh and access tokens


#### 2. Conducting ongoing conversational interaction
---
* Passing in a user 'utterance' to the inference API for the established session
* Processing of returned 'events' ie. conversational fragments, Agent state updates and errors.
* All events are transformed into typed data structures that are passed back to the the caller via callbacks. 

#### 3. Error handling
---
* All errors are passed back to the the caller via callbacks.
* Client code should catch exceptions arising from session initialisation or turn processing but report errors as they arrive via the error callback.





