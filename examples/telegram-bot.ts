import { Telegraf } from 'telegraf';
import { CoreMessage, generateText, CoreTool } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import AgentekToolkit from '../src/ai-sdk/toolkit';
import { ensTools } from '../src/shared/ens';
import { transferTools } from '../src/shared/transfer';
import { Hex, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import 'dotenv/config';

/////////////////////////////////////////////////////////////////////////
// Simple Telegram bot that uses AI to assist with crypto transactions //
/////////////////////////////////////////////////////////////////////////

if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

// Initialize Crypto SDK
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const chains = [mainnet, sepolia];
const toolkit = new AgentekToolkit({
    transports: [http(), http()],
    chains,
    accountOrAddress: account,
    tools: [...ensTools(), ...transferTools()],
});

const tools = toolkit.getTools();

// Store conversation states
const userStates = new Map<number, {
    pendingTransfer: boolean;
    messages: CoreMessage[];
}>();

// Handle all messages
bot.on('text', async (ctx) => {
    try {
        if (ctx.message.text === '/start') {
            await ctx.reply("Hi! I'm your AI crypto assistant. I can help you send transactions and more. Just chat with me naturally!");
            return;
        }

        // Initialize or get user state
        if (!userStates.has(ctx.from.id)) {
            userStates.set(ctx.from.id, {
                pendingTransfer: false,
                messages: []
            });
        }
        const userState = userStates.get(ctx.from.id)!;

        await ctx.reply('Thinking...');

        // Add user's message to history
        userState.messages.push({
            role: "user",
            content: ctx.message.text
        } as CoreMessage);

        const response = await generateText({
            model: openrouter("anthropic/claude-3.5-sonnet"),
            system: `You are a helpful AI crypto assistant. When handling transfers:

1. If user requests a transfer:
   - First resolve the ENS name
   - Show the resolved address
   - Show transaction details and ASK for confirmation
   - Only proceed with intentTransfer after user confirms

2. If user is confirming a transfer:
   - Double check they want to proceed
   - Use intentTransfer to execute
   - Show transaction details after it's sent

Always wait for explicit confirmation before sending any transactions.
Keep track of whether you're waiting for confirmation or not.
Current state: ${userState.pendingTransfer ? 'Waiting for transfer confirmation' : 'No pending transfers'}`,
            messages: userState.messages.slice(-10),
            maxSteps: 5,
            tools: tools as Record<string, CoreTool<any, any>>,
            experimental_activeTools: Object.keys(tools),
        });

        // Process response
        for (const message of response.response.messages) {
            if (typeof message.content === "string") {
                await ctx.reply(message.content);
                userState.messages.push({
                    role: "assistant",
                    content: message.content
                } as CoreMessage);
            } else {
                for (const content of message.content) {
                    if (content.type === "text") {
                        await ctx.reply(content.text);
                        userState.messages.push({
                            role: "assistant",
                            content: content.text
                        } as CoreMessage);
                    } else if (content.type === "tool-call") {
                        // Update state based on tool being called
                        if (content.toolName === "intentTransfer") {
                            userState.pendingTransfer = false;
                        }
                    } else if (content.type === "tool-result") {
                        try {
                            if (typeof content.result !== 'string') continue;
                            const result = JSON.parse(content.result);
                            
                            if (result.hash) {
                                const chainName = result.chain === mainnet.id ? 'Mainnet' : 'Sepolia';
                                const txMessage = `✅ Transaction sent!\n\nHash: ${result.hash}\nNetwork: ${chainName}\nView on Explorer: ${
                                    result.chain === mainnet.id ? 
                                    `https://etherscan.io/tx/${result.hash}` : 
                                    `https://sepolia.etherscan.io/tx/${result.hash}`
                                }`;
                                await ctx.reply(txMessage);
                                userState.messages.push({
                                    role: "assistant",
                                    content: txMessage
                                } as CoreMessage);
                            }
                        } catch {
                            continue;
                        }
                    }
                }
            }
        }

    } catch (error) {
        console.error('Error:', error);
        await ctx.reply('Sorry, I encountered an error processing your message.');
    }
});

// Start bot
bot.launch().then(() => {
    console.log('🤖 AI Crypto Assistant is running!');
    console.log('Wallet Address:', account.address);
    console.log('Networks: Mainnet, Sepolia');
}).catch(console.error);

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));