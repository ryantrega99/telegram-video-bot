import axios from 'axios';

const BASE_URL = 'https://api.freepik.com/v1/ai/image-to-video';

export interface FreepikJobResponse {
  data: {
    id: string;
  };
}

export interface FreepikStatusResponse {
  data: {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    video?: {
      url: string;
    };
    error?: string;
  };
}

export async function generateVideo(imageUrl: string, prompt: string, model: string, duration: string) {
  const apiKey = process.env.FREEPIK_API_KEY;
  try {
    const response = await axios.post<FreepikJobResponse>(
      BASE_URL,
      {
        image_url: imageUrl,
        prompt: prompt,
        model: model,
        duration: parseInt(duration) || 5,
      },
      {
        headers: {
          'x-freepik-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.data.id;
  } catch (error: any) {
    console.error('Freepik API Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to start video generation');
  }
}

export async function checkVideoStatus(jobId: string) {
  const apiKey = process.env.FREEPIK_API_KEY;
  try {
    const response = await axios.get<FreepikStatusResponse>(`${BASE_URL}/${jobId}`, {
      headers: {
        'x-freepik-api-key': apiKey,
      },
    });
    return response.data.data;
  } catch (error: any) {
    console.error('Freepik Status Error:', error.response?.data || error.message);
    throw new Error('Failed to check video status');
  }
}
