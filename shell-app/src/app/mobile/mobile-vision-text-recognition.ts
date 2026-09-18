import { registerPlugin } from '@capacitor/core';

export interface MobileVisionTextRecognitionPlugin {
  detectText(options: { base64Image: string }): Promise<{ text: string }>;
}

export const MobileVisionTextRecognition = registerPlugin<MobileVisionTextRecognitionPlugin>(
  'MobileVisionTextRecognition',
);
