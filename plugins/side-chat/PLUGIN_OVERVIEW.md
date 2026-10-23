Ask a follow-up question about one message without adding noise to the main conversation. A side chat is a fork of the thread that opens in a panel beside it.

## What you get

- A **Reply in side chat** action on any message. Select part of the message first to reply to only that text.
- A **Start side chat** panel action for a fork that starts from the current thread state.
- A panel that shows the quoted message and a compact chat with its own composer.
- A **Send to main thread** action on side-chat replies. It queues the reply as a message in the original thread.

## How it works

The fork copies the conversation up to the chosen message and reuses the same workspace. The quoted text is given to the agent as context. Side chats stay hidden from the sidebar, so they do not clutter your thread list.

The plugin supplies a task boundary in both agent configuration and the first side-chat message's agent-only context, including side chats opened without a quoted message. Inherited history is background; main-thread goals and pending work are inactive here. The agent should answer questions without editing files or advancing the main task, then wait for your next message. You can still explicitly ask the side-chat agent to perform a task. These instructions apply only to this plugin's side chats; ordinary forks keep their existing behavior. Existing live provider sessions receive updated configuration when they are next constructed; start a new side chat to receive the first-message context.

The explicit first-message context avoids relying solely on providers to replace instructions in inherited sessions. Creating a side chat still leaves the fork idle; its task boundary is delivered when you send the first message.

Once per hour, the plugin looks for side chats older than 24 hours. A side chat with no user message and no queued message is archived. A side chat you used is kept.

The plugin adds no agent tools or CLI commands.
