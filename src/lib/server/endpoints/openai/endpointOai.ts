import type OpenAI from 'openai';
import type {
   ChatCompletionCreateParamsNonStreaming,
   ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import type { CompletionCreateParamsStreaming } from 'openai/resources/completions';
import { z } from 'zod';

import { env } from '@env';
import { buildPrompt } from '@lib/buildPrompt';
import type { MessageFile } from '@lib/types/Message';

import type {
   Endpoint,
   EndpointParameters,
   StreamingEndpoint,
   TextGenerationOutputWithTools,
} from '../endpoints';
import type { EndpointMessage } from '../endpoints';
import {
   createImageProcessorOptionsValidator,
   makeImageProcessor,
} from '../images';
import { openAIChatToTextGenerationStream } from './openAIChatToTextGenerationStream';
import { openAICompletionToTextGenerationStream } from './openAICompletionToTextGenerationStream';

export const endpointOAIParametersSchema = z.object({
   weight: z.number().int().positive().default(1),
   model: z.any(),
   type: z.literal('openai'),
   baseURL: z.string().url().default('https://api.openai.com/v1'),
   apiKey: z.string().default(env.OPENAI_API_KEY ?? 'sk-'),
   completion: z
      .union([z.literal('completions'), z.literal('chat_completions')])
      .default('chat_completions'),
   defaultHeaders: z.record(z.string()).optional(),
   defaultQuery: z.record(z.string()).optional(),
   extraBody: z.record(z.any()).optional(),
   multimodal: z
      .object({
         image: createImageProcessorOptionsValidator({
            supportedMimeTypes: [
               'image/png',
               'image/jpeg',
               'image/webp',
               'image/avif',
               'image/tiff',
               'image/gif',
            ],
            preferredMimeType: 'image/webp',
            maxSizeInMB: Infinity,
            maxWidth: 4096,
            maxHeight: 4096,
         }),
      })
      .default({}),
});

export async function endpointOai(
   input: z.input<typeof endpointOAIParametersSchema>
): Promise<Endpoint> {
   const {
      baseURL,
      apiKey,
      completion,
      model,
      defaultHeaders,
      defaultQuery,
      multimodal,
      extraBody,
   } = endpointOAIParametersSchema.parse(input);

   let OpenAI;
   try {
      OpenAI = (await import('openai')).OpenAI;
   } catch (e) {
      throw new Error(`Failed to import OpenAI. ${JSON.stringify(e, null, 3)}`);
   }

   const openai = new OpenAI({
      apiKey: apiKey ?? 'sk-',
      baseURL,
      defaultHeaders,
      defaultQuery,
   });

   const imageProcessor = makeImageProcessor(multimodal.image);

   if (completion === 'chat_completions') {
      return async ({
         messages,
         preprompt,
         generateSettings,
      }: EndpointParameters) => {
         let messagesOpenAI: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
            await prepareMessages(messages, imageProcessor);

         if (messagesOpenAI?.[0]?.role !== 'system') {
            messagesOpenAI = [
               { role: 'system', content: '' },
               ...messagesOpenAI,
            ];
         }

         if (messagesOpenAI?.[0]) {
            messagesOpenAI[0].content = preprompt ?? '';
         }

         const parameters = { ...model.parameters, ...generateSettings };
         const body: ChatCompletionCreateParamsNonStreaming = {
            model: model.id ?? model.name,
            messages: messagesOpenAI,
            max_tokens: parameters?.max_new_tokens,
            stop: parameters?.stop,
            temperature: parameters?.temperature,
            top_p: parameters?.top_p,
            frequency_penalty: parameters?.repetition_penalty,
         };

         const chatCompletion = await openai.chat.completions.create(body, {
            body: { ...body, ...extraBody },
         });
         if (!chatCompletion) {
            throw new Error('Failed to generate chat completion');
         }

         return {
            content: chatCompletion.choices[0].message.content ?? '',
            details: {
               generatedTokens: chatCompletion.usage?.completion_tokens ?? 0,
               finish_reason: 'length',
               prefill: [],
               tokens: [],
            },
         } satisfies TextGenerationOutputWithTools;
      };
   } else {
      throw new Error('Invalid completion type');
   }
}

export async function streamingEndpointOai(
   input: z.input<typeof endpointOAIParametersSchema>
): Promise<StreamingEndpoint> {
   const {
      baseURL,
      apiKey,
      completion,
      model,
      defaultHeaders,
      defaultQuery,
      multimodal,
      extraBody,
   } = endpointOAIParametersSchema.parse(input);

   /* eslint-disable-next-line no-shadow */
   let OpenAI;
   try {
      OpenAI = (await import('openai')).OpenAI;
   } catch (e) {
      throw new Error(`Failed to import OpenAI. ${JSON.stringify(e, null, 3)}`);
   }

   const openai = new OpenAI({
      apiKey: apiKey ?? 'sk-',
      baseURL,
      defaultHeaders,
      defaultQuery,
   });

   const imageProcessor = makeImageProcessor(multimodal.image);

   if (completion === 'completions') {
      return async ({
         messages,
         preprompt,
         continueMessage,
         generateSettings,
      }) => {
         const prompt = await buildPrompt({
            messages,
            continueMessage,
            preprompt,
            model,
         });

         const parameters = { ...model.parameters, ...generateSettings };
         const body: CompletionCreateParamsStreaming = {
            model: model.id ?? model.name,
            prompt,
            stream: true,
            max_tokens: parameters?.max_new_tokens,
            stop: parameters?.stop,
            temperature: parameters?.temperature,
            top_p: parameters?.top_p,
            frequency_penalty: parameters?.repetition_penalty,
         };

         const openAICompletion = await openai.completions.create(body, {
            body: { ...body, ...extraBody },
         });

         return openAICompletionToTextGenerationStream(openAICompletion);
      };
   } else if (completion === 'chat_completions') {
      return async ({ messages, preprompt, generateSettings }) => {
         let messagesOpenAI: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
            await prepareMessages(messages, imageProcessor);

         if (messagesOpenAI?.[0]?.role !== 'system') {
            messagesOpenAI = [
               { role: 'system', content: '' },
               ...messagesOpenAI,
            ];
         }

         if (messagesOpenAI?.[0]) {
            messagesOpenAI[0].content = preprompt ?? '';
         }

         const parameters = { ...model.parameters, ...generateSettings };
         const body: ChatCompletionCreateParamsStreaming = {
            model: model.id ?? model.name,
            messages: messagesOpenAI,
            stream: true,
            max_tokens: parameters?.max_new_tokens,
            stop: parameters?.stop,
            temperature: parameters?.temperature,
            top_p: parameters?.top_p,
            frequency_penalty: parameters?.repetition_penalty,
         };

         const openChatAICompletion = await openai.chat.completions.create(
            body,
            {
               body: { ...body, ...extraBody },
            }
         );

         return openAIChatToTextGenerationStream(openChatAICompletion);
      };
   } else {
      throw new Error('Invalid completion type');
   }
}

async function prepareMessages(
   messages: EndpointMessage[],
   imageProcessor: ReturnType<typeof makeImageProcessor>
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
   return Promise.all(
      messages.map(async (message) => {
         if (message.from === 'user') {
            return {
               role: message.from,
               content: [
                  ...(await prepareFiles(imageProcessor, message.files ?? [])),
                  { type: 'text', text: message.content },
               ],
            };
         }
         return {
            role: message.from,
            content: message.content,
         };
      })
   );
}

async function prepareFiles(
   imageProcessor: ReturnType<typeof makeImageProcessor>,
   files: MessageFile[]
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPartImage[]> {
   const processedFiles = await Promise.all(files.map(imageProcessor));
   return processedFiles.map((file) => ({
      type: 'image_url' as const,
      image_url: {
         url: `data:${file.mime};base64,${file.image.toString('base64')}`,
      },
   }));
}
