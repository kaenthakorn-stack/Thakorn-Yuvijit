

import { GoogleGenAI, Type, Modality } from '@google/genai';
// FIX: Import React to make the `React` namespace available for types like React.FormEvent.
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// --- Type Definitions ---
type Idea = {
  id: string; // Unique ID for feedback tracking
  conceptName: string;
  format: string;
  shortPlot: string;
  visualAudioDirection: string;
  hook: string;
  imageUrl?: string;
  script?: ScriptScene[]; // Script is now part of the idea
};

type ScriptScene = {
  scene: string;
  shot: string;
  cameraAngle: string;
  cameraMovement: string;
  visualDescription: string;
  audio: string;
  approxDuration: string;
};

type AssessmentResult = {
  scores: {
    [key: string]: number; // Dynamic keys for scores
  };
  feedback: {
    strengths: string;
    improvements: string;
  };
};

type DesignAssessmentResult = {
  scores: {
    visualAppeal: number;
    usabilityClarity: number;
    originality: number;
    designComposition: number;
    alignmentWithGoal: number;
  };
  feedback: {
    strengths: string;
    improvements: string;
  };
};

type SpeechResult = {
    title: string;
    script: string;
};

type User = {
    user: string;
    email: string;
};

type UserSettings = {
  speechStyle?: string;
  imageStyle?: string;
  imageAspectRatio?: string;
  assessmentMediaType?: string;
  creativeAudience?: string;
  creativeGoal?: string;
};


// --- Helper Functions ---
const blobToBase64 = (blob: Blob): Promise<{ base64: string, mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            const mimeType = blob.type || result.split(';')[0].split(':')[1];
            resolve({ base64, mimeType });
        };
        reader.onerror = error => reject(error);
    });
};

const getApiErrorMessage = (error: any): string => {
    let combinedMessage = '';

    if (typeof error === 'string') {
        combinedMessage = error;
    } else if (error instanceof Error) {
        // Standard Error object
        combinedMessage = error.message;
    } else if (typeof error === 'object' && error !== null) {
        // Handle custom error objects, potentially from APIs
        // Combine multiple possible properties into one string for a comprehensive check
        combinedMessage = [
            error.message,
            error.error?.message,
            // As a fallback, stringify the whole object to catch error codes/statuses
            // that might be top-level properties.
            JSON.stringify(error) 
        ].filter(Boolean).join(' '); // filter(Boolean) removes null/undefined/empty strings
    }

    const lowerCaseMessage = combinedMessage.toLowerCase();

    if (lowerCaseMessage.includes('quota') || lowerCaseMessage.includes('resource_exhausted') || lowerCaseMessage.includes('429')) {
        return 'โควต้าการใช้งาน API ถึงขีดจำกัดแล้ว (อาจเป็นต่อนาทีหรือต่อวัน) โปรดรอสักครู่แล้วลองอีกครั้ง หรือตรวจสอบแผนการใช้งานของคุณ';
    }
    
    // A more generic error for other API issues
    return 'เกิดข้อผิดพลาดในการสื่อสารกับ AI โปรดลองอีกครั้งในภายหลัง';
};


// --- Data Logging ---
// IMPORTANT: Replace this placeholder with your actual Google Apps Script Web App URL for data logging.
// This script should be set up to accept POST requests and append data to a Google Sheet.
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID_HERE/exec';

const logInteraction = async (user: User | null, logData: object) => {
    if (!user || !GOOGLE_SCRIPT_URL.includes('/macros/s/')) {
        if (GOOGLE_SCRIPT_URL.includes('/macros/s/')) {
             console.log("Logging skipped: User not available or URL not configured.", logData);
        }
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('timestamp', new Date().toISOString());
        formData.append('userId', user.user);
        formData.append('userEmail', user.email);

        // Append all other log data
        for (const key in logData) {
            let value = logData[key];
            // Stringify objects/arrays so they can be stored in a single cell
            if (typeof value === 'object' && value !== null) {
                value = JSON.stringify(value);
            }
            formData.append(key, String(value));
        }

        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: formData,
            mode: 'no-cors', // Use no-cors for fire-and-forget logging
        });
    } catch (error) {
        // Log errors to the console, but don't disrupt the user experience
        console.error('Failed to log interaction data:', error);
    }
};


// --- API Client Initialization ---
// The API key is expected to be available in the environment variables.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- API Request Queue for Rate Limiting ---
let isApiBusy = false;
const apiQueue: (() => Promise<void>)[] = [];

// Free tier API usage can be strictly rate-limited (e.g., 1 request per minute).
// We'll enforce a delay between requests to avoid 429 errors.
// Increasing to 65 seconds to be more conservative.
const REQUEST_DELAY = 65000;

const processApiQueue = async () => {
    if (isApiBusy || apiQueue.length === 0) {
        return;
    }

    isApiBusy = true;
    const requestTask = apiQueue.shift();

    if (requestTask) {
        try {
            await requestTask();
        } catch (error) {
            // The task itself should handle component-specific error states,
            // but we log here for debugging.
            console.error("An error occurred while processing an API request from the queue:", error);
        }
    }
    
    // Wait for the delay before allowing the next request to be processed.
    setTimeout(() => {
        isApiBusy = false;
        processApiQueue();
    }, REQUEST_DELAY);
};

const enqueueApiRequest = (task: () => Promise<void>) => {
    apiQueue.push(task);
    processApiQueue();
};

// --- UI Components ---

const Header = ({ onGoHome, user, onLogout }) => (
  <header className="bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 p-4 border-b border-slate-700/60 shadow-lg">
    <nav className="container mx-auto flex justify-between items-center">
      <button onClick={onGoHome} className="text-xl md:text-2xl font-bold bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-transparent bg-clip-text hover:opacity-90 transition-opacity">AI Creativity Tool</button>
      {user && (
         <div className="flex items-center gap-4 text-slate-300 text-sm">
            <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" viewBox="-2 -2 24 24" fill="currentColor">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                <span className="font-semibold">{user}</span>
            </div>
            <button onClick={onLogout} className="flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors font-medium bg-slate-700/50 hover:bg-red-500/80 px-3 py-1.5 rounded-lg">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
                </svg>
                <span>Logout</span>
            </button>
         </div>
      )}
    </nav>
  </header>
);

const Footer = () => (
  <footer className="bg-transparent p-6 mt-12 text-center text-sm text-slate-500">
    <p>ผู้จัดทำ: ฐากร อยู่วิจิตร | © {new Date().getFullYear()}</p>
  </footer>
);

const LoginModule = ({ onLogin }) => {
  const [user, setUser] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.trim() || !email.trim()) {
      setError('กรุณากรอกข้อมูลให้ครบทุกช่อง');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
        setError('รูปแบบอีเมลไม่ถูกต้อง');
        return;
    }
    
    setError('');
    setLoading(true);

    const userData = { user, email };
    // Log the successful login event.
    await logInteraction(userData, {
        task: 'User Login',
        status: 'Success'
    });
    
    onLogin(userData);
  };

  return (
    <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-8 rounded-2xl shadow-2xl animate-fade-in">
      <h2 className="text-4xl font-bold mb-2 text-center bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-transparent bg-clip-text">AI Creativity Tool</h2>
      <p className="text-slate-400 mb-8 text-center">กรุณาลงชื่อเพื่อเข้าใช้งาน</p>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="user" className="block text-sm font-medium text-slate-300 mb-2">
            ผู้ใช้งาน (User)
          </label>
          <input
            id="user"
            name="user"
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition"
            placeholder="ชื่อของคุณ"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
            อีเมล์ (Email)
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition"
            placeholder="you@example.com"
          />
        </div>
        {error && <p className="text-red-400 text-sm text-center font-medium">{error}</p>}
        <div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 text-white font-bold py-3 px-4 rounded-lg transition-opacity duration-300 disabled:bg-slate-600 disabled:opacity-70 flex items-center justify-center h-12"
          >
            {loading ? <div className="loader !w-6 !h-6 !border-2"></div> : 'Login / เข้าสู่ระบบ'}
          </button>
        </div>
      </form>
    </div>
  );
};


const Welcome = ({ onNavigate }) => (
    <div className="relative text-center p-8 md:p-16 bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 rounded-2xl shadow-2xl animate-fade-in container mx-auto mt-10">
        <h2 className="text-4xl md:text-6xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-transparent bg-clip-text">AI-Powered Creativity Tool</h2>
        <p className="text-lg md:text-xl text-slate-300 mb-8">เลือกเครื่องมือที่ต้องการใช้งาน</p>
        <div className="flex flex-col md:flex-row justify-center gap-6 flex-wrap mb-20">
            <button
                onClick={() => onNavigate('creativeCorner')}
                className="bg-gradient-to-r from-cyan-400 to-sky-500 hover:shadow-cyan-400/30 text-white font-bold py-3 px-8 rounded-full text-lg transition-all transform hover:scale-105 hover:-translate-y-1 shadow-lg"
            >
                สร้างสรรค์ไอเดีย
            </button>
             <button
                onClick={() => onNavigate('speechGeneration')}
                className="bg-gradient-to-r from-rose-500 to-pink-500 hover:shadow-rose-500/30 text-white font-bold py-3 px-8 rounded-full text-lg transition-all transform hover:scale-105 hover:-translate-y-1 shadow-lg"
            >
                สร้างสรรค์บทพูด
            </button>
            <button
                onClick={() => onNavigate('imageGeneration')}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:shadow-amber-500/30 text-white font-bold py-3 px-8 rounded-full text-lg transition-all transform hover:scale-105 hover:-translate-y-1 shadow-lg"
            >
                สร้างสรรค์ภาพ
            </button>
            <button
                onClick={() => onNavigate('assessment')}
                className="bg-gradient-to-r from-indigo-500 to-violet-500 hover:shadow-indigo-500/30 text-white font-bold py-3 px-8 rounded-full text-lg transition-all transform hover:scale-105 hover:-translate-y-1 shadow-lg"
            >
                ประเมินผลงานสื่อมีเดีย
            </button>
             <button
                onClick={() => onNavigate('designAssessment')}
                className="bg-gradient-to-r from-emerald-500 to-green-500 hover:shadow-emerald-500/30 text-white font-bold py-3 px-8 rounded-full text-lg transition-all transform hover:scale-105 hover:-translate-y-1 shadow-lg"
            >
                ประเมินผลงานการออกแบบ
            </button>
        </div>
        <div className="absolute bottom-6 right-6 flex items-center gap-3">
             <button
                onClick={() => onNavigate('userGuide')}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium py-2 px-4 rounded-full text-xs sm:text-sm transition-colors shadow-lg flex items-center gap-1.5"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span>คู่มือการใช้งานแอพลิเคชั่น</span>
            </button>
             <button
                onClick={() => onNavigate('creator')}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium py-2 px-4 rounded-full text-xs sm:text-sm transition-colors shadow-lg flex items-center gap-1.5"
            >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0L7.86 5.89c-.33.13-.67.33-.96.56l-2.68-1.4c-1.45-.76-3.08.38-2.58 1.9l1.37 4.12c.15.45.15.95 0 1.4l-1.37 4.12c-.5 1.52 1.13 2.66 2.58 1.9l2.68-1.4c.29-.23.63-.43.96-.56l.65 2.72c.38 1.56 2.6 1.56 2.98 0l.65-2.72c.33.13.67.33.96.56l2.68 1.4c1.45.76 3.08-.38 2.58-1.9l-1.37-4.12c-.15-.45-.15-.95 0-1.4l1.37 4.12c.5-1.52-1.13-2.66-2.58-1.9l-2.68 1.4c-.29.23-.63-.43-.96-.56L11.49 3.17zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
                <span>ผู้สร้างเครื่องมือ</span>
            </button>
        </div>
    </div>
);

const CreativeCorner = ({ onGoHome, savedIdeas, setSavedIdeas, user, userSettings, updateUserSettings }) => {
  const [topic, setTopic] = useState('');
  const [customTopic, setCustomTopic] = useState('');
  const [audience, setAudience] = useState(userSettings?.creativeAudience || '');
  const [goal, setGoal] = useState(userSettings?.creativeGoal || '');
  const [duration, setDuration] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [loadingScript, setLoadingScript] = useState(false);
  const [scriptLoadingIndex, setScriptLoadingIndex] = useState<number | null>(null);
  const [imageLoading, setImageLoading] = useState<{ [key: number]: boolean }>({});
  const [error, setError] = useState('');
  const [activeScriptIdeaId, setActiveScriptIdeaId] = useState<string | null>(null);
  const [playingSceneIndex, setPlayingSceneIndex] = useState<number | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const ideaIteration = useRef(0);
  const imageIteration = useRef(0);
  const scriptIteration = useRef(0);
  const isMounted = useRef(true);

  // Effect to load speech synthesis voices and manage mounted state
  useEffect(() => {
    isMounted.current = true;
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      if (availableVoices.length > 0) {
        setVoices(availableVoices);
      }
    };

    if ('speechSynthesis' in window) {
      loadVoices();
      // Some browsers load voices asynchronously.
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Cleanup function to cancel speech and remove listener
    return () => {
      isMounted.current = false;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
        window.speechSynthesis.cancel();
      }
    };
  }, []);


  const handleGenerateIdeas = () => {
    const finalTopic = topic === 'custom' ? customTopic.trim() : topic;
    if (!finalTopic || !audience || !goal) {
      setError('กรุณากรอกข้อมูลให้ครบทุกช่อง');
      return;
    }
    setError('');
    setLoadingIdeas(true);
    setIdeas([]);
    setActiveScriptIdeaId(null);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    ideaIteration.current += 1;
    const startTime = Date.now();

    enqueueApiRequest(async () => {
      const promptData = { topic: finalTopic, audience, goal, duration };
      try {
        const durationInfo = duration ? `- ความยาววิดีโอที่ต้องการ: ${duration}\n` : '';
        const prompt = `คุณคือผู้เชี่ยวชาญด้านกลยุทธ์คอนเทนต์สำหรับโซเชียลมีเดีย สร้างสรรค์ไอเดียสำหรับวิดีโอสั้น (เช่น TikTok หรือ Instagram Reels) ที่ไม่ซ้ำใครจำนวน 3 ไอเดียจากข้อมูลต่อไปนี้ โดยให้ผลลัพธ์ทั้งหมดเป็นภาษาไทย
        - หัวข้อ/ผลิตภัณฑ์: ${finalTopic}
        - กลุ่มเป้าหมาย: ${audience}
        - เป้าหมายของคอนเทนต์: ${goal}
        ${durationInfo}สำหรับแต่ละไอเดีย ให้ระบุ ชื่อคอนเซ็ปต์ (conceptName), รูปแบบ (format), เรื่องย่อ (shortPlot), แนวทางภาพและเสียง (visualAudioDirection), และฮุคที่ดึงดูด (hook)`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                ideas: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      conceptName: { type: Type.STRING },
                      format: { type: Type.STRING },
                      shortPlot: { type: Type.STRING },
                      visualAudioDirection: { type: Type.STRING },
                      hook: { type: Type.STRING },
                    },
                    required: ['conceptName', 'format', 'shortPlot', 'visualAudioDirection', 'hook'],
                  },
                },
              },
              required: ['ideas'],
            },
          },
        });

        const parsedResponse = JSON.parse(response.text);
        const newIdeas = parsedResponse.ideas.map((idea, index) => ({
          ...idea,
          id: `idea-${Date.now()}-${index}`, // Add unique ID
        }));
        
        if (isMounted.current) {
          setIdeas(newIdeas);
          localStorage.setItem('creativeContent', JSON.stringify(newIdeas));
        }

        logInteraction(user, {
            task: 'Idea Generation',
            status: 'Success',
            durationMs: Date.now() - startTime,
            prompt: promptData,
            result: newIdeas,
            iteration: ideaIteration.current,
            collaborationPattern: 'Co-creation'
        });

      } catch (err) {
        console.error(err);
        const friendlyError = getApiErrorMessage(err);
        logInteraction(user, {
            task: 'Idea Generation',
            status: 'Error',
            durationMs: Date.now() - startTime,
            prompt: promptData,
            result: err.message,
            iteration: ideaIteration.current,
            collaborationPattern: 'Co-creation'
        });
        if (isMounted.current) {
          setError(friendlyError);
        }
      } finally {
        if (isMounted.current) {
          setLoadingIdeas(false);
        }
      }
    });
  };

  const handleGenerateImage = (idea: Idea, index: number) => {
    if (isMounted.current) {
        setImageLoading(prev => ({ ...prev, [index]: true }));
        setError('');
    }
    const startTime = Date.now();
    imageIteration.current += 1;
    const prompt = `ภาพตัวอย่างสำหรับวิดีโอสั้น สไตล์ภาพยนตร์ รายละเอียดสูง สไตล์: ${idea.visualAudioDirection} ฉาก: ${idea.shortPlot}`;

    enqueueApiRequest(async () => {
        try {
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: prompt,
                config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '9:16',
                },
            });
            const imageUrl = `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`;
            
            logInteraction(user, {
                task: 'Idea Image Generation',
                status: 'Success',
                durationMs: Date.now() - startTime,
                prompt: { originalIdea: idea, imagePrompt: prompt },
                result: 'Image generated successfully', // Not logging base64
                iteration: imageIteration.current,
                collaborationPattern: 'Co-creation'
            });

            if (isMounted.current) {
                setIdeas(currentIdeas => {
                    const updatedIdeas = currentIdeas.map((item, idx) =>
                        idx === index ? { ...item, imageUrl } : item
                    );
                    localStorage.setItem('creativeContent', JSON.stringify(updatedIdeas));
                    return updatedIdeas;
                });
            }
        } catch (err) {
            console.error(err);
            const errorMessage = getApiErrorMessage(err);
            logInteraction(user, {
                task: 'Idea Image Generation',
                status: 'Error',
                durationMs: Date.now() - startTime,
                prompt: { originalIdea: idea, imagePrompt: prompt },
                result: err.message,
                iteration: imageIteration.current,
                collaborationPattern: 'Co-creation'
            });
            if (isMounted.current) {
                setError(errorMessage);
            }
        } finally {
            if (isMounted.current) {
                setImageLoading(prev => ({ ...prev, [index]: false }));
            }
        }
    });
  };
  
  const handleGenerateScript = (idea: Idea, index: number) => {
    setLoadingScript(true);
    setScriptLoadingIndex(index);
    setError('');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const startTime = Date.now();
    scriptIteration.current += 1;
    
    enqueueApiRequest(async () => {
        try {
            const prompt = `คุณคือมืออาชีพด้านการเขียนสคริปต์ภาษาไทย สร้างสคริปต์สำหรับถ่ายทำวิดีโอสั้นจากข้อมูลไอเดียต่อไปนี้ โดยให้ผลลัพธ์ทั้งหมดเป็นภาษาไทย
            - ชื่อคอนเซ็ปต์: "${idea.conceptName}"
            - ฮุค: "${idea.hook}"
            - พล็อตเรื่อง: "${idea.shortPlot}"
            - แนวทางภาพและเสียง: "${idea.visualAudioDirection}"
            สร้างสคริปต์โดยละเอียดสำหรับถ่ายทำ โดยผลลัพธ์ต้องเป็น JSON array ของแต่ละฉาก และค่าของ property ทั้งหมด (scene, shot, cameraAngle, cameraMovement, visualDescription, audio, approxDuration) ต้องเป็นภาษาไทย`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                        script: {
                            type: Type.ARRAY,
                            items: {
                            type: Type.OBJECT,
                            properties: {
                                scene: { type: Type.STRING },
                                shot: { type: Type.STRING },
                                cameraAngle: { type: Type.STRING },
                                cameraMovement: { type: Type.STRING },
                                visualDescription: { type: Type.STRING },
                                audio: { type: Type.STRING },
                                approxDuration: { type: Type.STRING },
                            },
                            required: ['scene', 'shot', 'cameraAngle', 'cameraMovement', 'visualDescription', 'audio', 'approxDuration'],
                            },
                        },
                        },
                        required: ['script'],
                    },
                },
            });

            const parsedResponse = JSON.parse(response.text);
            const newScript = parsedResponse.script;

            logInteraction(user, {
                task: 'Script Generation',
                status: 'Success',
                durationMs: Date.now() - startTime,
                prompt: idea,
                result: newScript,
                iteration: scriptIteration.current,
                collaborationPattern: 'Co-creation'
            });
            
            if (isMounted.current) {
                setIdeas(currentIdeas => {
                    const updatedIdeas = currentIdeas.map((item, idx) => 
                        idx === index ? { ...item, script: newScript } : item
                    );
                    localStorage.setItem('creativeContent', JSON.stringify(updatedIdeas));
                    return updatedIdeas;
                });
                setActiveScriptIdeaId(idea.id);
            }

        } catch (err) {
            console.error(err);
            const friendlyError = getApiErrorMessage(err);
            logInteraction(user, {
                task: 'Script Generation',
                status: 'Error',
                durationMs: Date.now() - startTime,
                prompt: idea,
                result: err.message,
                iteration: scriptIteration.current,
                collaborationPattern: 'Co-creation'
            });
            if (isMounted.current) {
                setError(friendlyError);
            }
        } finally {
            if (isMounted.current) {
                setLoadingScript(false);
                setScriptLoadingIndex(null);
            }
        }
    });
  };
  
  const handlePlayAudio = (scene: ScriptScene, index: number) => {
    if (!('speechSynthesis' in window)) {
        alert("ขออภัย บราวเซอร์ของคุณไม่รองรับการอ่านออกเสียง");
        return;
    }

    if (playingSceneIndex === index) {
        window.speechSynthesis.cancel();
        setPlayingSceneIndex(null);
        return;
    }
    
    window.speechSynthesis.cancel();

    const textToSpeak = `ภาพ: ${scene.visualDescription} เสียง: ${scene.audio}`;
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    const thaiVoice = voices.find(voice => voice.lang === 'th-TH');
    if (thaiVoice) {
        utterance.voice = thaiVoice;
    }
    utterance.lang = 'th-TH';

    utterance.onstart = () => setPlayingSceneIndex(index);
    utterance.onend = () => setPlayingSceneIndex(null);
    utterance.onerror = () => {
        setPlayingSceneIndex(null);
        setError("เกิดข้อผิดพลาดในการเล่นเสียง");
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleSaveScript = (ideaToSave: Idea) => {
    if (!ideaToSave.script || !ideaToSave.script.length) return;

    let fileContent = `Shooting Script for: ${ideaToSave.conceptName}\n`;
    fileContent += "==================================================\n\n";

    ideaToSave.script.forEach((scene) => {
        fileContent += `Scene Shot: ${scene.scene} / ${scene.shot}\n`;
        fileContent += `----------------------------------------\n`;
        fileContent += `Camera Angle: ${scene.cameraAngle}\n`;
        fileContent += `Camera Movement: ${scene.cameraMovement}\n`;
        fileContent += `Descript: ${scene.visualDescription}\n`;
        fileContent += `Sound: ${scene.audio}\n`;
        fileContent += `Time: ${scene.approxDuration}\n\n`;
    });
    
    fileContent += "Generated by AI Creativity Tool";

    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `${ideaToSave.conceptName.replace(/\s+/g, '_').toLowerCase()}_script.txt`;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const handleSaveIdea = (ideaToSave: Idea) => {
    const isAlreadySaved = savedIdeas.some(idea => idea.id === ideaToSave.id);
    if (!isAlreadySaved) {
      setSavedIdeas([...savedIdeas, ideaToSave]);
    }
  };


  return (
    <div className="container mx-auto p-4 space-y-8 animate-fade-in">
      <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-cyan-400">สร้างสรรค์ไอเดีย (Idea Generation)</h2>
           <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <span>หน้าหลัก</span>
            </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="bg-slate-800 p-2 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="" disabled>-- เลือกหัวข้อ / ผลิตภัณฑ์ --</option>
                <optgroup label="หมวดหมู่ทั่วไป">
                    <option value="รีวิวสินค้า/บริการ">รีวิวสินค้า/บริการ</option>
                    <option value="สอน/ให้ความรู้">สอน/ให้ความรู้</option>
                    <option value="เล่าเรื่อง (Storytelling)">เล่าเรื่อง (Storytelling)</option>
                    <option value="เบื้องหลังการทำงาน">เบื้องหลังการทำงาน</option>
                    <option value="Q&A / ถาม-ตอบ">Q&A / ถาม-ตอบ</option>
                    <option value="ท้าทาย / Challenge">ท้าทาย / Challenge</option>
                    <option value="เปรียบเทียบ">เปรียบเทียบ</option>
                </optgroup>
                <optgroup label="หมวดหมู่เฉพาะ">
                    <option value="อาหารและเครื่องดื่ม">อาหารและเครื่องดื่ม</option>
                    <option value="แฟชั่นและความงาม">แฟชั่นและความงาม</option>
                    <option value="เทคโนโลยีและแกดเจ็ต">เทคโนโลยีและแกดเจ็ต</option>
                    <option value="การท่องเที่ยว">การท่องเที่ยว</option>
                    <option value="การออกกำลังกายและสุขภาพ">การออกกำลังกายและสุขภาพ</option>
                    <option value="การเงินและการลงทุน">การเงินและการลงทุน</option>
                    <option value="หนังสั้น">หนังสั้น</option>
                    <option value="ภาพยนตร์">ภาพยนตร์</option>
                    <option value="สารคดี">สารคดี</option>
                </optgroup>
                <option value="custom">อื่นๆ (โปรดระบุ)</option>
            </select>
            <input type="text" value={audience} onChange={(e) => { setAudience(e.target.value); updateUserSettings({ creativeAudience: e.target.value }); }} placeholder="กลุ่มเป้าหมาย" className="bg-slate-800 p-2 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
            <input type="text" value={goal} onChange={(e) => { setGoal(e.target.value); updateUserSettings({ creativeGoal: e.target.value }); }} placeholder="เป้าหมายของคอนเทนต์" className="bg-slate-800 p-2 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
            <input type="text" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="ความยาววิดีโอ (เช่น 1 นาที)" className="bg-slate-800 p-2 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
            {topic === 'custom' && (
                <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    placeholder="ระบุหัวข้อของคุณที่นี่"
                    className="bg-slate-800 p-2 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 md:col-span-2 lg:col-span-4"
                />
            )}
        </div>
        <button onClick={handleGenerateIdeas} disabled={loadingIdeas} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-10">
          {loadingIdeas ? <div className="loader !w-6 !h-6 !border-2"></div> : 'สร้างไอเดีย'}
        </button>
        {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
      </section>

      {ideas.length > 0 && (
        <section className="animate-fade-in">
          <h3 className="text-xl font-bold mb-4">ไอเดียที่สร้างโดย AI:</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ideas.map((idea, index) => {
              const isSaved = savedIdeas.some(saved => saved.id === idea.id);
              return (
              <div key={idea.id} className="bg-slate-800/70 p-4 rounded-xl shadow-lg border border-slate-700 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-lg text-cyan-400">{idea.conceptName}</h4>
                  <p className="text-sm text-slate-400 mb-2"><strong>รูปแบบ:</strong> {idea.format}</p>
                  <p className="text-sm mb-2"><strong>Hook:</strong> {idea.hook}</p>
                  <p className="text-sm mb-2"><strong>เรื่องย่อ:</strong> {idea.shortPlot}</p>
                  <p className="text-sm mb-2"><strong>ภาพและเสียง:</strong> {idea.visualAudioDirection}</p>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="aspect-[9/16] bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-600 flex items-center justify-center overflow-hidden">
                    {imageLoading[index] ? (
                        <div className="loader"></div>
                    ) : idea.imageUrl ? (
                        <img src={idea.imageUrl} alt={`AI generated image for ${idea.conceptName}`} className="w-full h-full object-cover"/>
                    ) : (
                         <button onClick={() => handleGenerateImage(idea, index)} className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition text-sm flex items-center space-x-2">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                            </svg>
                            <span>สร้างภาพตัวอย่าง</span>
                         </button>
                    )}
                  </div>
                   <button onClick={() => handleGenerateScript(idea, index)} disabled={loadingScript} className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-slate-600">
                    {scriptLoadingIndex === index ? 'กำลังสร้าง...' : idea.script ? 'สร้างสคริปต์ใหม่' : 'สร้างสคริปต์'}
                  </button>
                  <button
                    onClick={() => handleSaveIdea(idea)}
                    disabled={isSaved}
                    className="w-full bg-gradient-to-r from-yellow-500 to-amber-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-slate-600 disabled:opacity-70 flex items-center justify-center gap-2"
                  >
                    {isSaved ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span>บันทึกแล้ว</span>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-3.13L5 18V4z" />
                        </svg>
                        <span>บันทึกไอเดีย</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )})}
          </div>
        </section>
      )}

      {activeScriptIdeaId && (() => {
        const activeIdeaForScript = ideas.find(i => i.id === activeScriptIdeaId);
        if (!activeIdeaForScript || !activeIdeaForScript.script) return null;
        
        return (
            <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl animate-fade-in">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-cyan-400">ร่างสคริปต์สำหรับ "{activeIdeaForScript.conceptName}"</h2>
                <button onClick={() => handleSaveScript(activeIdeaForScript)} className="bg-gradient-to-r from-green-500 to-emerald-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.293a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  <span>บันทึกเป็นไฟล์</span>
                </button>
              </div>
              <div className="space-y-4">
                {activeIdeaForScript.script.map((scene, index) => (
                  <div key={index} className={`bg-slate-800/50 p-4 rounded-xl transition-all duration-300 ${playingSceneIndex === index ? 'bg-cyan-900/50 ring-2 ring-cyan-500 shadow-lg shadow-cyan-500/20' : 'border border-transparent hover:border-slate-600'}`}>
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h4 className="text-lg font-bold text-cyan-400">
                          Scene Shot: {scene.scene} / {scene.shot}
                        </h4>
                      </div>
                      {'speechSynthesis' in window && (
                        <button onClick={() => handlePlayAudio(scene, index)} className="flex-shrink-0 text-slate-300 hover:text-cyan-400 transition p-2 rounded-full" aria-label={playingSceneIndex === index ? `Stop playing audio for scene ${scene.scene}` : `Play audio for scene ${scene.scene}`}>
                          {playingSceneIndex === index ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.198-1.882a1 1 0 000-1.664l-3.198-1.882z" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="mt-4 border-t border-slate-600 pt-4 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                        <div className="space-y-1">
                            <p className="font-semibold text-slate-300">Camera Angle:</p>
                            <p className="text-slate-400">{scene.cameraAngle}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="font-semibold text-slate-300">Camera Movement:</p>
                            <p className="text-slate-400">{scene.cameraMovement}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="font-semibold text-slate-300">Time:</p>
                            <p className="text-slate-400">{scene.approxDuration}</p>
                        </div>
                        <div className="md:col-span-3 space-y-1">
                            <p className="font-semibold text-slate-300">Descript:</p>
                            <p className="text-slate-400">{scene.visualDescription}</p>
                        </div>
                         <div className="md:col-span-3 space-y-1">
                            <p className="font-semibold text-slate-300">Sound:</p>
                            <p className="text-slate-400">{scene.audio}</p>
                        </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
        );
    })()}
    </div>
  );
};

const SavedIdeasModal = ({ isOpen, onClose, ideas, onUseIdea, onDeleteIdea }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-700 flex-shrink-0">
          <h3 className="text-xl font-bold text-cyan-400">เลือกไอเดียที่บันทึกไว้</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {ideas.length === 0 ? (
          <div className="flex-grow flex flex-col items-center justify-center text-slate-500 p-8">
             <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <p className="mt-4 text-xl">ยังไม่มีไอเดียที่บันทึกไว้</p>
          </div>
        ) : (
          <div className="p-4 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ideas.map((idea : Idea) => (
                <div key={idea.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex flex-col justify-between hover:border-cyan-500 transition-colors">
                  <div>
                    <h4 className="font-bold text-cyan-400">{idea.conceptName}</h4>
                    <p className="text-sm text-slate-400 mt-2"><strong>Hook:</strong> {idea.hook}</p>
                    <p className="text-sm text-slate-400 mt-1"><strong>เรื่องย่อ:</strong> {idea.shortPlot}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <button 
                        onClick={() => onUseIdea(idea)} 
                        className="flex-1 bg-gradient-to-r from-cyan-500 to-sky-600 hover:opacity-90 text-white font-bold py-2 px-3 rounded-lg transition text-sm flex items-center justify-center gap-2"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                            <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                        </svg>
                        <span>นำไปใช้</span>
                    </button>
                    <button 
                        onClick={() => onDeleteIdea(idea.id)} 
                        className="bg-red-600/80 hover:bg-red-600 text-white font-bold py-2 px-3 rounded-lg transition text-sm"
                        aria-label="ลบไอเดีย"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                        </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SpeechGenerationModule = ({ onGoHome, savedIdeas, setSavedIdeas, user, userSettings, updateUserSettings }) => {
    const [topic, setTopic] = useState('');
    const [customTopic, setCustomTopic] = useState('');
    const [audience, setAudience] = useState('');
    const [goal, setGoal] = useState('');
    const [speakerStyle, setSpeakerStyle] = useState(userSettings?.speechStyle || '');
    const [duration, setDuration] = useState('');
    const [speechResult, setSpeechResult] = useState<SpeechResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const speechIteration = useRef(0);
    const transcriptionIteration = useRef(0);
    
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
    const audioChunks = useRef<Blob[]>([]);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const handleToggleRecording = () => {
        if (isRecording && mediaRecorder) {
            mediaRecorder.stop();
            setIsRecording(false);
            // onstop handler will trigger processing
        } else {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    audioChunks.current = [];
                    const recorder = new MediaRecorder(stream);

                    recorder.ondataavailable = event => {
                        audioChunks.current.push(event.data);
                    };

                    recorder.onstop = () => {
                        // Stop all media tracks to turn off the browser's mic indicator
                        stream.getTracks().forEach(track => track.stop());
                        if (!isMounted.current) return;

                        setIsProcessingSpeech(true);
                        setError('');
                        const startTime = Date.now();
                        transcriptionIteration.current += 1;
                        
                        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
                        
                        enqueueApiRequest(async () => {
                            try {
                                const { base64, mimeType } = await blobToBase64(audioBlob);
                                const response = await ai.models.generateContent({
                                    model: 'gemini-2.5-flash',
                                    contents: {
                                        parts: [
                                            { text: "ถอดเสียงพูดในไฟล์เสียงนี้เป็นข้อความภาษาไทย" },
                                            { inlineData: { data: base64, mimeType: mimeType } },
                                        ],
                                    },
                                });
    
                                if (isMounted.current) {
                                    const transcribedText = response.text.trim();
                                     logInteraction(user, {
                                        task: 'Speech-to-Text Transcription',
                                        status: 'Success',
                                        durationMs: Date.now() - startTime,
                                        prompt: 'Audio speech input',
                                        result: transcribedText,
                                        iteration: transcriptionIteration.current,
                                        collaborationPattern: 'AI-assisted'
                                    });
                                    if (transcribedText) {
                                        setTopic('custom');
                                        setCustomTopic(prev => prev ? `${prev} ${transcribedText}` : transcribedText);
                                    } else {
                                        setError("ไม่สามารถถอดเสียงได้ โปรดลองพูดให้ชัดเจนขึ้น");
                                    }
                                }
                            } catch (err) {
                                console.error("Speech transcription failed:", err);
                                const friendlyError = getApiErrorMessage(err);
                                logInteraction(user, {
                                    task: 'Speech-to-Text Transcription',
                                    status: 'Error',
                                    durationMs: Date.now() - startTime,
                                    prompt: 'Audio speech input',
                                    result: err.message,
                                    iteration: transcriptionIteration.current,
                                    collaborationPattern: 'AI-assisted'
                                });
                                if (isMounted.current) {
                                    setError(friendlyError);
                                }
                            } finally {
                                if (isMounted.current) {
                                    setIsProcessingSpeech(false);
                                }
                            }
                        });
                    };
                    
                    recorder.start();
                    setMediaRecorder(recorder);
                    setIsRecording(true);
                })
                .catch(err => {
                    console.error("Error accessing microphone:", err);
                    setError("ไม่สามารถเข้าถึงไมโครโฟนได้ โปรดตรวจสอบการอนุญาตในเบราว์เซอร์ของคุณ");
                });
        }
    };


    const handleGenerateSpeech = () => {
        const finalTopic = topic === 'custom' ? customTopic.trim() : topic;
        if (!finalTopic || !audience || !goal || !speakerStyle) {
            setError('กรุณากรอกข้อมูลให้ครบทุกช่อง (ยกเว้นความยาว)');
            return;
        }
        setError('');
        setLoading(true);
        setSpeechResult(null);
        setIsCopied(false);
        speechIteration.current += 1;
        const startTime = Date.now();
        const promptData = { topic: finalTopic, audience, goal, speakerStyle, duration };

        enqueueApiRequest(async () => {
            try {
                const durationInfo = duration ? `- ความยาวที่ต้องการ: ${duration}\n` : '';
                const prompt = `คุณคือผู้เชี่ยวชาญด้านการเขียนบทพูด (Speechwriter) มืออาชีพ สร้างสรรค์บทพูดที่ทรงพลังและน่าประทับใจจากข้อมูลต่อไปนี้ โดยให้ผลลัพธ์ทั้งหมดเป็นภาษาไทย
- หัวข้อ / ประเด็นหลัก: ${finalTopic}
- กลุ่มผู้ฟัง: ${audience}
- เป้าหมายของการพูด: ${goal}
- สไตล์ของผู้พูด: ${speakerStyle}
${durationInfo}
โปรดสร้างบทพูดที่สมบูรณ์ มีการเกริ่นนำ เนื้อหา และบทสรุปที่ชัดเจน พร้อมตั้งชื่อเรื่องที่น่าสนใจ`;

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING, description: 'ชื่อเรื่องของบทพูด' },
                                script: { type: Type.STRING, description: 'เนื้อหาบทพูดทั้งหมด มีการเว้นวรรคและขึ้นย่อหน้าอย่างเหมาะสม' }
                            },
                            required: ['title', 'script']
                        }
                    }
                });
                
                if (isMounted.current) {
                    const result = JSON.parse(response.text) as SpeechResult;
                    setSpeechResult(result);
                    logInteraction(user, {
                        task: 'Speech Generation',
                        status: 'Success',
                        durationMs: Date.now() - startTime,
                        prompt: promptData,
                        result: result,
                        iteration: speechIteration.current,
                        collaborationPattern: 'AI-assisted'
                    });
                }
            } catch (err) {
                console.error(err);
                const friendlyError = getApiErrorMessage(err);
                 logInteraction(user, {
                    task: 'Speech Generation',
                    status: 'Error',
                    durationMs: Date.now() - startTime,
                    prompt: promptData,
                    result: err.message,
                    iteration: speechIteration.current,
                    collaborationPattern: 'AI-assisted'
                });
                if (isMounted.current) {
                    setError(friendlyError);
                }
            } finally {
                if (isMounted.current) {
                    setLoading(false);
                }
            }
        });
    };

    const handleCopy = () => {
        if (speechResult?.script) {
            navigator.clipboard.writeText(speechResult.script);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        }
    };

    const handleSaveSpeech = () => {
        if (!speechResult?.script) return;

        let fileContent = `Title: ${speechResult.title}\n`;
        fileContent += "==================================================\n\n";
        fileContent += speechResult.script;
        fileContent += "\n\n==================================================\n";
        fileContent += "Generated by AI Creativity Tool";

        const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const fileName = `${speechResult.title.replace(/\s+/g, '_').toLowerCase()}_speech.txt`;
        link.download = fileName;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleUseIdea = (idea: Idea) => {
        const combinedTopic = `${idea.conceptName}: ${idea.shortPlot}`;
        setTopic('custom');
        setCustomTopic(combinedTopic);
        setGoal('');
        setAudience('');
        setSpeakerStyle('');
        setDuration('');
        setIsModalOpen(false);
    };

    const handleRemoveIdea = (ideaIdToRemove: string) => {
        if (window.confirm('คุณแน่ใจหรือไม่ว่าต้องการลบไอเดียนี้')) {
            const updatedIdeas = savedIdeas.filter(idea => idea.id !== ideaIdToRemove);
            setSavedIdeas(updatedIdeas);
        }
    };

    return (
        <div className="container mx-auto p-4 space-y-8 animate-fade-in">
            <SavedIdeasModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                ideas={savedIdeas}
                onUseIdea={handleUseIdea}
                onDeleteIdea={handleRemoveIdea}
            />
            <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl">
                <div className="flex justify-between items-center mb-4 gap-4">
                    <h2 className="text-2xl font-bold text-cyan-400">สร้างสรรค์บทพูด (Speech Generation)</h2>
                    <div className="flex items-center gap-2 flex-shrink-0">
                         <button 
                            onClick={() => setIsModalOpen(true)} 
                            className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:shadow-yellow-400/30 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm"
                         >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-3.13L5 18V4z" />
                            </svg>
                            <span>ดูไอเดีย ({savedIdeas.length})</span>
                        </button>
                        <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                            </svg>
                            <span className="hidden sm:inline">หน้าหลัก</span>
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <select
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        className="md:col-span-2 bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                        <option value="" disabled>-- เลือกประเภทบทพูด / สคริปต์ --</option>
                        <optgroup label="บทพูดทั่วไป">
                            <option value="การกล่าวเปิดงาน">การกล่าวเปิดงาน</option>
                            <option value="การนำเสนอผลงาน">การนำเสนอผลงาน</option>
                            <option value="การกล่าวสุนทรพจน์">การกล่าวสุนทรพจน์</option>
                            <option value="การกล่าวปิดงาน">การกล่าวปิดงาน</option>
                            <option value="การพูดสร้างแรงบันดาลใจ">การพูดสร้างแรงบันดาลใจ</option>
                            <option value="การอบรม/บรรยาย">การอบรม/บรรยาย</option>
                        </optgroup>
                        <optgroup label="สคริปต์สำหรับคอนเทนต์ครีเอเตอร์">
                            <option value="สคริปต์วิดีโอสั้น (Tiktok/Reels)">สคริปต์วิดีโอสั้น (Tiktok/Reels)</option>
                            <option value="สคริปต์รีวิวสินค้า/บริการ">สคริปต์รีวิวสินค้า/บริการ</option>
                            <option value="สคริปต์พอดแคสต์">สคริปต์พอดแคสต์</option>
                            <option value="สคริปต์วิดีโอสอน/ให้ความรู้">สคริปต์วิดีโอสอน/ให้ความรู้</option>
                            <option value="สคริปต์เล่าเรื่อง (Storytelling)">สคริปต์เล่าเรื่อง (Storytelling)</option>
                            <option value="สคริปต์หนังสั้น">สคริปต์หนังสั้น</option>
                            <option value="สคริปต์ภาพยนตร์ (โครงเรื่อง/เรื่องย่อ)">สคริปต์ภาพยนตร์ (โครงเรื่อง/เรื่องย่อ)</option>
                            <option value="สคริปต์สารคดี">สคริปต์สารคดี</option>
                        </optgroup>
                        <option value="custom">อื่น ๆ (โปรดระบุ)</option>
                    </select>

                    {topic === 'custom' && (
                        <input
                            type="text"
                            value={customTopic}
                            onChange={(e) => setCustomTopic(e.target.value)}
                            placeholder="ระบุหัวข้อของคุณที่นี่"
                            className="md:col-span-2 bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                    )}

                    <input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="กลุ่มผู้ฟัง" className="bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    <input type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="เป้าหมายของการพูด" className="bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    <input 
                        type="text" 
                        value={speakerStyle} 
                        onChange={(e) => {
                            setSpeakerStyle(e.target.value);
                            updateUserSettings({ speechStyle: e.target.value });
                        }} 
                        placeholder="สไตล์ของผู้พูด (เช่น ทางการ, สร้างแรงบันดาลใจ)" 
                        className="bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" 
                    />
                    <input type="text" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="ความยาวที่ต้องการ (เช่น 5 นาที)" className="bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                </div>
                 <div className="relative my-6 flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                        <div className="w-full border-t border-slate-700"></div>
                    </div>
                    <div className="relative flex justify-center">
                        <span className="bg-slate-900 px-2 text-sm text-slate-500">หรือ</span>
                    </div>
                </div>
                <div className="flex flex-col items-center justify-center gap-2 mb-6">
                    <p className="text-slate-400 text-center text-sm">ใช้เสียงของคุณเพื่อสร้างไอเดียสำหรับหัวข้อ/ประเด็นหลัก</p>
                    <button
                        type="button"
                        onClick={handleToggleRecording}
                        disabled={loading}
                        className={`flex items-center justify-center gap-3 w-full max-w-xs px-4 py-3 rounded-lg font-bold text-white transition-all duration-300 disabled:opacity-50 ${
                            isRecording 
                                ? 'bg-red-600 hover:bg-red-700 ring-2 ring-red-400 ring-offset-2 ring-offset-slate-900' 
                                : isProcessingSpeech 
                                    ? 'bg-slate-600 cursor-not-allowed' 
                                    : 'bg-gradient-to-r from-teal-500 to-cyan-600 hover:opacity-90'
                        }`}
                    >
                        {isRecording ? (
                            <>
                                <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                                </span>
                                <span>กำลังบันทึก... (คลิกเพื่อหยุด)</span>
                            </>
                        ) : isProcessingSpeech ? (
                            <>
                                <div className="loader !w-5 !h-5 !border-2 !border-t-white"></div>
                                <span>กำลังประมวลผล...</span>
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                                    <path d="M5.5 10.5a.5.5 0 01.5.5v1a4 4 0 004 4h0a4 4 0 004-4v-1a.5.5 0 011 0v1a5 5 0 01-4.5 4.975V19h2.5a.5.5 0 010 1h-6a.5.5 0 010-1H10v-1.525A5 5 0 015.5 12v-1a.5.5 0 01.5-.5z" />
                                </svg>
                                <span>บันทึกไอเดียด้วยเสียง</span>
                            </>
                        )}
                    </button>
                </div>
                <button onClick={handleGenerateSpeech} disabled={loading || isProcessingSpeech} className="w-full bg-gradient-to-r from-rose-500 to-pink-600 hover:opacity-90 text-white font-bold py-3 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-12">
                    {loading ? <div className="loader !w-6 !h-6 !border-2"></div> : 'สร้างบทพูด'}
                </button>
                {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
            </section>

            {speechResult && (
                <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl animate-fade-in">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-2xl font-bold text-cyan-400">{speechResult.title}</h3>
                        <div className="flex items-center gap-2">
                             <button onClick={handleSaveSpeech} className="bg-gradient-to-r from-green-500 to-emerald-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.293a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                                <span>บันทึกเป็นไฟล์</span>
                            </button>
                            <button onClick={handleCopy} className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm disabled:bg-green-600 disabled:cursor-not-allowed" disabled={isCopied}>
                                {isCopied ? (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                        <span>คัดลอกแล้ว!</span>
                                    </>
                                ) : (
                                    <>
                                         <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                                            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                                        </svg>
                                        <span>คัดลอกบทพูด</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-lg max-h-[60vh] overflow-y-auto">
                        <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{speechResult.script}</p>
                    </div>
                </section>
            )}
        </div>
    );
};


const AssessmentModule = ({ onGoHome, user, userSettings, updateUserSettings }) => {
  const [workToAssess, setWorkToAssess] = useState('');
  const [goalOfWork, setGoalOfWork] = useState('');
  const [mediaType, setMediaType] = useState(userSettings?.assessmentMediaType || 'วีดิโอคอนเทนต์');
  const [fileName, setFileName] = useState('');
  const [videoForAssessment, setVideoForAssessment] = useState<{ file: File, base64: string, mimeType: string } | null>(null);
  const [imageForAssessment, setImageForAssessment] = useState<{ file: File, base64: string, mimeType: string } | null>(null);
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [error, setError] = useState('');
  const assessmentIteration = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);
  
  // Professional Assessment Criteria by Media Type
  const assessmentCriteria = {
    'ภาพยนตร์': {
        plotAndNarrative: "โครงเรื่องและการเล่าเรื่อง (Plot & Narrative)",
        characterDevelopment: "การพัฒนาตัวละคร (Character Development)",
        cinematography: "การถ่ายทำและกำกับภาพ (Cinematography)",
        editingAndPacing: "การตัดต่อและจังหวะ (Editing & Pacing)",
        soundDesign: "การออกแบบเสียงและดนตรีประกอบ (Sound Design & Music Score)",
        themeAndMessage: "แก่นเรื่องและสาร (Theme & Message)"
    },
    'หนังสั้น': {
        conceptAndOriginality: "แนวคิดและความคิดริเริ่ม (Concept & Originality)",
        storytellingEfficiency: "ประสิทธิภาพการเล่าเรื่องในเวลาจำกัด (Storytelling Efficiency)",
        visualStorytelling: "การเล่าเรื่องด้วยภาพ (Visual Storytelling)",
        emotionalImpact: "ผลกระทบทางอารมณ์ (Emotional Impact)",
        technicalExecution: "คุณภาพการผลิตทางเทคนิค (Technical Execution)"
    },
    'สปอตโฆษณา': {
        brandMessageClarity: "ความชัดเจนของสาร (Brand Message Clarity)",
        callToAction: "ประสิทธิผลของ Call-to-Action (CTA Effectiveness)",
        memorabilityAndHook: "การสร้างการจดจำและ Hook (Memorability & Hook)",
        targetAudienceAlignment: "ความสอดคล้องกับกลุ่มเป้าหมาย (Target Audience Alignment)",
        persuasion: "พลังในการโน้มน้าวใจ (Persuasion)"
    },
    'วีดิโอคอนเทนต์': {
        engagementHook: "การดึงดูดความสนใจในช่วงต้น (Engagement Hook)",
        valueDelivery: "การนำเสนอคุณค่า (ข้อมูล/ความบันเทิง) (Value Delivery)",
        visualAndAudioQuality: "คุณภาพของภาพและเสียง (Visual & Audio Quality)",
        pacingAndEditing: "จังหวะและการตัดต่อ (Pacing & Editing)",
        viewerRetention: "การรักษาผู้ชม (Viewer Retention)"
    },
    'โมชั่นวีดิโอ': {
        visualDesignAndAesthetics: "การออกแบบภาพและความสวยงาม (Visual Design & Aesthetics)",
        animationQuality: "คุณภาพการเคลื่อนไหว (Animation Quality & Fluidity)",
        clarityOfMessage: "ความชัดเจนของข้อความ (Clarity of Message)",
        pacingAndRhythm: "จังหวะและความเร็ว (Pacing & Rhythm)",
        soundIntegration: "การผสมผสานของเสียง (Sound Integration)"
    },
    'แอนิเมชัน': {
        storytelling: "การเล่าเรื่องและโครงสร้าง (Storytelling & Structure)",
        artDirectionAndStyle: "สไตล์ภาพและอาร์ตไดเร็คชั่น (Art Direction & Style)",
        characterDesignAndAppeal: "การออกแบบตัวละครและความน่าดึงดูด (Character Design & Appeal)",
        animationPrinciples: "การใช้หลักการแอนิเมชัน (Application of Animation Principles)",
        soundDesign: "การออกแบบเสียงและดนตรี (Sound & Music Design)"
    },
    'สารคดี': {
        researchAndCredibility: "การค้นคว้าและความน่าเชื่อถือ (Research & Credibility)",
        narrativeStructure: "โครงสร้างการเล่าเรื่อง (Narrative Structure & Flow)",
        visualEvidenceAndStorytelling: "การใช้ภาพเพื่อเล่าเรื่องและสนับสนุนข้อมูล (Visual Evidence & Storytelling)",
        pointOfView: "มุมมองการนำเสนอและความเป็นกลาง (Point of View & Objectivity)",
        emotionalAndIntellectualImpact: "ผลกระทบทางอารมณ์และความคิด (Emotional & Intellectual Impact)"
    },
    'มิวสิควิดีโอ': {
        conceptAndOriginality: "แนวคิดและความคิดสร้างสรรค์ (Concept & Originality)",
        visualInterpretationOfMusic: "การตีความเพลงผ่านภาพ (Visual Interpretation of Music)",
        cinematographyAndEditing: "การถ่ายทำและการตัดต่อ (Cinematography & Editing)",
        artistPerformance: "การแสดงของศิลปิน (Artist Performance & Representation)",
        aestheticAndStyle: "สุนทรียศาสตร์และสไตล์ (Aesthetics & Style)"
    },
    'ภาพถ่าย': {
        composition: "องค์ประกอบภาพ (Composition)",
        lighting: "การจัดแสง (Lighting)",
        subjectAndStorytelling: "หัวข้อและเรื่องราว (Subject & Storytelling)",
        technicalQuality: "คุณภาพทางเทคนิค (Technical Quality)",
        emotionalImpact: "ผลกระทบทางอารมณ์ (Emotional Impact)"
    },
    'ศิลปะ': {
        conceptAndOriginality: "แนวคิดและความคิดริเริ่ม (Concept & Originality)",
        techniqueAndExecution: "เทคนิคและฝีมือ (Technique & Execution)",
        compositionAndForm: "องค์ประกอบและรูปทรง (Composition & Form)",
        emotionalExpression: "การแสดงออกทางอารมณ์ (Emotional Expression)",
        viewerInterpretation: "การเปิดกว้างต่อการตีความ (Viewer Interpretation)"
    },
    'อื่นๆ': {
        creativity: "ความคิดสร้างสรรค์ (Creativity)",
        clarity: "ความชัดเจนในการสื่อสาร (Clarity of Communication)",
        engagement: "การมีส่วนร่วมของผู้ชม (Audience Engagement)",
        goalAlignment: "ความสอดคล้องกับเป้าหมาย (Alignment with Goal)"
    }
  };
  
  const getCriteriaForMediaType = (type: string) => {
      return assessmentCriteria[type] || assessmentCriteria['อื่นๆ'];
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setError('');
      setAssessmentResult(null);
      setFileName(file.name);
      
      // Clear previous inputs
      setWorkToAssess('');
      setVideoForAssessment(null);
      setImageForAssessment(null);

      if (file.type.startsWith('text/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          setWorkToAssess(text);
        };
        reader.onerror = () => {
          setError('เกิดข้อผิดพลาดในการอ่านไฟล์');
          setFileName('');
        };
        reader.readAsText(file);
      } else if (file.type.startsWith('video/')) {
        setIsProcessingFile(true);
        try {
          const { base64, mimeType } = await blobToBase64(file);
          setVideoForAssessment({ file, base64, mimeType });
        } catch (err) {
          console.error(err);
          setError('เกิดข้อผิดพลาดในการประมวลผลวิดีโอ');
          setFileName('');
        } finally {
          setIsProcessingFile(false);
        }
      } else if (file.type.startsWith('image/')) {
        setIsProcessingFile(true);
        try {
          const { base64, mimeType } = await blobToBase64(file);
          setImageForAssessment({ file, base64, mimeType });
        } catch (err) {
          console.error(err);
          setError('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ');
          setFileName('');
        } finally {
          setIsProcessingFile(false);
        }
      } else {
        setError('กรุณาอัปโหลดไฟล์ .txt, วิดีโอ หรือรูปภาพเท่านั้น');
        setFileName('');
      }
      
      event.target.value = ''; // Reset file input
    }
  };

  const handleRemoveFile = () => {
    setVideoForAssessment(null);
    setImageForAssessment(null);
    setFileName('');
  };
  
  const handleAssessWork = () => {
    if ((!workToAssess.trim() && !videoForAssessment && !imageForAssessment) || !goalOfWork.trim()) {
      setError('กรุณากรอกข้อมูลผลงาน (ข้อความ, วิดีโอ หรือรูปภาพ) และเป้าหมายให้ครบถ้วน');
      return;
    }
    setError('');
    setLoading(true);
    setAssessmentResult(null);
    assessmentIteration.current += 1;
    const startTime = Date.now();
    const promptData = {
        mediaType,
        goalOfWork,
        work: workToAssess || (fileName ? `File: ${fileName}`: 'File Input')
    };

    enqueueApiRequest(async () => {
        const currentCriteria = getCriteriaForMediaType(mediaType);
        const criteriaPrompt = Object.entries(currentCriteria).map(([key, label]) => {
            return `- ${label} (key: ${key})`;
        }).join('\n');
        
        const scoreProperties = Object.keys(currentCriteria).reduce((acc, key) => {
          acc[key] = { type: Type.INTEGER, description: `คะแนนสำหรับ ${currentCriteria[key]} (1-10)` };
          return acc;
        }, {});
    
        try {
          const prompt = `คุณคือผู้เชี่ยวชาญด้านการวิเคราะห์และประเมินผลงานสร้างสรรค์ โปรดประเมินผลงานต่อไปนี้ตามเกณฑ์ที่กำหนดสำหรับสื่อประเภทนี้โดยเฉพาะ โดยให้คะแนนแต่ละเกณฑ์ 1-10 พร้อมทั้งให้ความคิดเห็นเกี่ยวกับจุดแข็งและข้อเสนอแนะเพื่อการปรับปรุง ผลลัพธ์ทั้งหมดต้องเป็นภาษาไทย
    
          - ประเภทของสื่อ: "${mediaType}"
          - ผลงานที่ต้องการประเมิน: ${videoForAssessment ? "[วิเคราะห์จากไฟล์วิดีโอที่แนบมา]" : imageForAssessment ? "[วิเคราะห์จากไฟล์รูปภาพที่แนบมา]" : `"""${workToAssess}"""`}
          - เป้าหมายของผลงานนี้: "${goalOfWork}"
    
          เกณฑ์การประเมิน:
          ${criteriaPrompt}
    
          โปรดตอบกลับในรูปแบบ JSON เท่านั้น`;
          
          const mediaFile = imageForAssessment || videoForAssessment;
          const contents = mediaFile
            ? {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      data: mediaFile.base64,
                      mimeType: mediaFile.mimeType,
                    },
                  },
                ],
              }
            : prompt;
    
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  scores: {
                    type: Type.OBJECT,
                    properties: scoreProperties,
                    required: Object.keys(currentCriteria),
                  },
                  feedback: {
                    type: Type.OBJECT,
                    properties: {
                      strengths: { type: Type.STRING, description: "จุดแข็งของผลงาน" },
                      improvements: { type: Type.STRING, description: "ข้อเสนอแนะเพื่อการปรับปรุง" },
                    },
                    required: ['strengths', 'improvements'],
                  },
                },
                required: ['scores', 'feedback'],
              },
            },
          });
          
          if (isMounted.current) {
            const result = JSON.parse(response.text) as AssessmentResult;
            setAssessmentResult(result);
            logInteraction(user, {
                task: 'Media Assessment',
                status: 'Success',
                durationMs: Date.now() - startTime,
                prompt: promptData,
                result: result,
                iteration: assessmentIteration.current,
                collaborationPattern: 'AI-assisted'
            });
          }
    
        } catch (err) {
          console.error(err);
          const friendlyError = getApiErrorMessage(err);
          logInteraction(user, {
            task: 'Media Assessment',
            status: 'Error',
            durationMs: Date.now() - startTime,
            prompt: promptData,
            result: err.message,
            iteration: assessmentIteration.current,
            collaborationPattern: 'AI-assisted'
          });
          if (isMounted.current) {
            setError(friendlyError);
          }
        } finally {
          if (isMounted.current) {
            setLoading(false);
          }
        }
    });
  };

  return (
    <div className="container mx-auto p-4 space-y-8 animate-fade-in">
      <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-cyan-400">ประเมินผลงานสื่อมีเดีย (Media Work Assessment)</h2>
            <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <span>หน้าหลัก</span>
            </button>
        </div>
        <div className="space-y-4 mb-4">
           <select
            value={mediaType}
            onChange={(e) => {
              setMediaType(e.target.value);
              setAssessmentResult(null); // Reset result when type changes
              updateUserSettings({ assessmentMediaType: e.target.value });
            }}
            className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            aria-label="Media type"
          >
            <option value="วีดิโอคอนเทนต์">วีดิโอคอนเทนต์</option>
            <option value="หนังสั้น">หนังสั้น</option>
            <option value="ภาพยนตร์">ภาพยนตร์</option>
            <option value="สปอตโฆษณา">สปอตโฆษณา</option>
            <option value="โมชั่นวีดิโอ">โมชั่นวีดิโอ</option>
            <option value="แอนิเมชัน">แอนิเมชัน</option>
            <option value="สารคดี">สารคดี</option>
            <option value="มิวสิควิดีโอ">มิวสิควิดีโอ</option>
            <option value="ภาพถ่าย">ภาพถ่าย</option>
            <option value="ศิลปะ">ศิลปะ</option>
            <option value="อื่นๆ">อื่นๆ</option>
          </select>
           <input
            type="text"
            value={goalOfWork}
            onChange={(e) => setGoalOfWork(e.target.value)}
            placeholder="เป้าหมายของผลงานนี้คืออะไร? (เช่น เพิ่มการรับรู้, กระตุ้นยอดขาย)"
            className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            aria-label="Goal of the work"
          />
           <textarea
            value={workToAssess}
            onChange={(e) => {
              setWorkToAssess(e.target.value);
              if (videoForAssessment) {
                setVideoForAssessment(null);
                setFileName('');
              }
              if (imageForAssessment) {
                setImageForAssessment(null);
                setFileName('');
              }
            }}
            placeholder="วางเนื้อหา, สคริปต์... หรืออัปโหลดไฟล์ .txt / วิดีโอ / รูปภาพ"
            className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-40 resize-y disabled:bg-slate-700/50"
            aria-label="Work to assess"
            disabled={!!videoForAssessment || !!imageForAssessment}
          />
          {videoForAssessment && (
            <div className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                    <p className="text-sm text-slate-300 font-medium">วิดีโอสำหรับประเมิน:</p>
                    <button 
                        onClick={handleRemoveFile} 
                        className="text-red-500 hover:text-red-400 text-sm font-semibold flex items-center gap-1 transition-colors"
                        aria-label="ลบไฟล์วิดีโอ"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                        </svg>
                        <span>ลบไฟล์</span>
                    </button>
                </div>
                <video 
                    src={URL.createObjectURL(videoForAssessment.file)} 
                    controls 
                    className="w-full max-w-sm mx-auto rounded-md"
                >
                    เบราว์เซอร์ของคุณไม่รองรับการแสดงวิดีโอ
                </video>
            </div>
           )}
           {imageForAssessment && (
            <div className="p-3 bg-slate-800/50 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                    <p className="text-sm text-slate-300 font-medium">รูปภาพสำหรับประเมิน:</p>
                    <button 
                        onClick={handleRemoveFile} 
                        className="text-red-500 hover:text-red-400 text-sm font-semibold flex items-center gap-1 transition-colors"
                        aria-label="ลบไฟล์รูปภาพ"
                    >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                        </svg>
                        <span>ลบไฟล์</span>
                    </button>
                </div>
                <img 
                    src={URL.createObjectURL(imageForAssessment.file)} 
                    alt="Preview for assessment"
                    className="w-full max-w-sm mx-auto rounded-md"
                />
            </div>
           )}
           <div className="flex items-center gap-4">
              <label htmlFor="media-upload" className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.293a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                 </svg>
                 <span>อัปโหลดไฟล์ (TXT/Video/Image)</span>
              </label>
              <input id="media-upload" type="file" className="hidden" accept=".txt,text/plain,video/*,image/*" onChange={handleFileChange} />
              {isProcessingFile && <div className="loader !w-5 !h-5 !border-2"></div>}
              {fileName && !isProcessingFile && <span className="text-slate-400 text-sm truncate" title={fileName}>{fileName}</span>}
          </div>
        </div>
        <button onClick={handleAssessWork} disabled={loading || isProcessingFile} className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-10">
          {loading ? <div className="loader !w-6 !h-6 !border-2"></div> : 'ประเมินผลงาน'}
        </button>
        {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
      </section>
      
      {assessmentResult && (() => {
        const scoreValues = Object.values(assessmentResult.scores);
        const averageScore = scoreValues.length > 0 ? scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length : 0;
        const radius = 52;
        const circumference = 2 * Math.PI * radius;
        const strokeDashoffset = circumference - (averageScore / 10) * circumference;

        return (
          <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl animate-fade-in">
            <h3 className="text-2xl font-bold mb-6 text-cyan-400 text-center">ผลการประเมิน: {mediaType}</h3>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">

              {/* Overall Score Section */}
              <div className="lg:col-span-2 flex flex-col items-center justify-center p-6 bg-slate-800/40 rounded-xl">
                  <div className="relative w-40 h-40">
                      <svg className="w-full h-full" viewBox="0 0 120 120">
                          <circle
                              className="text-slate-700"
                              strokeWidth="10"
                              stroke="currentColor"
                              fill="transparent"
                              r={radius}
                              cx="60"
                              cy="60"
                          />
                          <circle
                              className="text-cyan-500"
                              strokeWidth="10"
                              strokeDasharray={circumference}
                              strokeDashoffset={strokeDashoffset}
                              strokeLinecap="round"
                              stroke="currentColor"
                              fill="transparent"
                              r={radius}
                              cx="60"
                              cy="60"
                              transform="rotate(-90 60 60)"
                              style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
                          />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-4xl font-bold text-white">
                              {averageScore.toFixed(1)}
                          </span>
                      </div>
                  </div>
                  <h4 className="text-xl font-semibold mt-4 text-gray-200">คะแนนโดยรวม</h4>
              </div>

              {/* Details Section */}
              <div className="lg:col-span-3">
                 {/* Scores Breakdown */}
                <div>
                  <h4 className="text-xl font-semibold mb-4 text-gray-200">คะแนนตามเกณฑ์</h4>
                  <div className="space-y-4">
                    {Object.entries(assessmentResult.scores).map(([key, value]) => (
                      <div key={key}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-slate-300">{getCriteriaForMediaType(mediaType)[key]}</span>
                          <span className="font-bold text-cyan-400">{value} / 10</span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2.5">
                          <div className="bg-gradient-to-r from-cyan-400 to-sky-500 h-2.5 rounded-full" style={{ width: `${value * 10}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Feedback Breakdown */}
                <div className="mt-8">
                  <h4 className="text-xl font-semibold mb-4 text-gray-200">ข้อเสนอแนะจาก AI</h4>
                  <div className="space-y-4">
                    <div className="bg-slate-800/50 p-4 rounded-lg">
                      <h5 className="font-bold text-green-400 mb-2">จุดแข็ง (Strengths)</h5>
                      <p className="text-slate-300 whitespace-pre-wrap">{assessmentResult.feedback.strengths}</p>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-lg">
                      <h5 className="font-bold text-yellow-400 mb-2">ข้อเสนอแนะเพื่อการปรับปรุง (Improvements)</h5>
                      <p className="text-slate-300 whitespace-pre-wrap">{assessmentResult.feedback.improvements}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        );
      })()}
    </div>
  );
};

const DesignAssessmentModule = ({ onGoHome, user }) => {
  const [designConcept, setDesignConcept] = useState('');
  const [designAudience, setDesignAudience] = useState('');
  const [designGoal, setDesignGoal] = useState('');
  const [designImages, setDesignImages] = useState<Array<{ file: File, base64: string, mimeType: string }>>([]);
  const [assessmentResult, setAssessmentResult] = useState<DesignAssessmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const assessmentIteration = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const handleImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
          setError('');
          // FIX: Explicitly type `file` as `File` to resolve property access errors on `unknown`.
          const newImagesPromises = Array.from(files).map((file: File) => {
              if (!file.type.startsWith('image/')) {
                  console.warn(`Skipping non-image file: ${file.name}`);
                  return Promise.resolve(null);
              }
              return blobToBase64(file).then(({ base64, mimeType }) => ({ file, base64, mimeType }));
          });

          try {
              const newImages = (await Promise.all(newImagesPromises)).filter((image): image is { file: File; base64: string; mimeType: string; } => image !== null);
              if (newImages.length === 0 && files.length > 0) {
                  setError('ไฟล์ที่เลือกไม่ใช่รูปภาพที่ถูกต้อง');
                  return;
              }
              setDesignImages(prev => [...prev, ...newImages]);
          } catch (err) {
              console.error(err);
              setError('เกิดข้อผิดพลาดในการประมวลผลไฟล์ภาพ');
          }
      }
  };
  
  const handleRemoveImage = (indexToRemove: number) => {
      setDesignImages(prev => prev.filter((_, index) => index !== indexToRemove));
  };
  
  const handleAssessDesign = () => {
    if (!designConcept.trim() || !designAudience.trim() || !designGoal.trim() || designImages.length === 0) {
        setError('กรุณากรอกข้อมูลและอัปโหลดรูปภาพให้ครบถ้วน');
        return;
    }
    setError('');
    setLoading(true);
    setAssessmentResult(null);
    assessmentIteration.current += 1;
    const startTime = Date.now();
    const promptData = {
        designConcept,
        designAudience,
        designGoal,
        imageCount: designImages.length
    };

    enqueueApiRequest(async () => {
        try {
            const textPart = {
                text: `คุณคือผู้เชี่ยวชาญด้านการออกแบบและ UX/UI โปรดประเมินผลงานออกแบบที่แนบมานี้เป็นชุดเดียวกัน (เช่น แผ่นพับหลายหน้า, หนังสือ, หรือชุดโพสต์โซเชียล) ตามเกณฑ์ที่กำหนด โดยให้คะแนนแต่ละเกณฑ์ 1-10 พร้อมทั้งให้ความคิดเห็นเกี่ยวกับจุดแข็งและข้อเสนอแนะเพื่อการปรับปรุง ผลลัพธ์ทั้งหมดต้องเป็นภาษาไทย โดยพิจารณาจากข้อมูลต่อไปนี้:
    
                - แนวคิดการออกแบบ: "${designConcept}"
                - กลุ่มเป้าหมาย: "${designAudience}"
                - เป้าหมายของการออกแบบ: "${designGoal}"
    
                เกณฑ์การประเมิน:
                1. ความสวยงาม (visualAppeal): การใช้สี, สไตล์, ความสวยงามโดยรวม
                2. ความชัดเจนและการใช้งาน (usabilityClarity): ความง่ายต่อการเข้าใจ, การใช้งานไม่ซับซ้อน
                3. ความคิดสร้างสรรค์ (originality): ความแปลกใหม่, ความโดดเด่นไม่ซ้ำใคร
                4. องค์ประกอบด้านการออกแบบ (designComposition): การจัดวาง (layout), ลำดับชั้นของข้อมูล (hierarchy), ความสมดุล (balance), และการใช้พื้นที่ว่าง (whitespace)
                5. ความสอดคล้องกับเป้าหมาย (alignmentWithGoal): การออกแบบตอบโจทย์เป้าหมายที่ตั้งไว้ได้ดีเพียงใด
    
                โปรดตอบกลับในรูปแบบ JSON เท่านั้น`
            };
            const imageParts = designImages.map(image => ({
                inlineData: {
                    data: image.base64,
                    mimeType: image.mimeType,
                },
            }));
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [textPart, ...imageParts] },
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            scores: {
                                type: Type.OBJECT,
                                properties: {
                                    visualAppeal: { type: Type.INTEGER, description: "คะแนนความสวยงาม (1-10)" },
                                    usabilityClarity: { type: Type.INTEGER, description: "คะแนนความชัดเจนและการใช้งาน (1-10)" },
                                    originality: { type: Type.INTEGER, description: "คะแนนความคิดสร้างสรรค์ (1-10)" },
                                    designComposition: { type: Type.INTEGER, description: "คะแนนองค์ประกอบด้านการออกแบบ (1-10)" },
                                    alignmentWithGoal: { type: Type.INTEGER, description: "คะแนนความสอดคล้องกับเป้าหมาย (1-10)" },
                                },
                                required: ['visualAppeal', 'usabilityClarity', 'originality', 'designComposition', 'alignmentWithGoal'],
                            },
                            feedback: {
                                type: Type.OBJECT,
                                properties: {
                                    strengths: { type: Type.STRING, description: "จุดแข็งของการออกแบบ" },
                                    improvements: { type: Type.STRING, description: "ข้อเสนอแนะเพื่อการปรับปรุง" },
                                },
                                required: ['strengths', 'improvements'],
                            },
                        },
                        required: ['scores', 'feedback'],
                    },
                },
            });
    
            if (isMounted.current) {
                const result = JSON.parse(response.text) as DesignAssessmentResult;
                setAssessmentResult(result);
                logInteraction(user, {
                    task: 'Design Assessment',
                    status: 'Success',
                    durationMs: Date.now() - startTime,
                    prompt: promptData,
                    result: result,
                    iteration: assessmentIteration.current,
                    collaborationPattern: 'AI-assisted'
                });
            }
    
        } catch (err) {
            console.error(err);
            const friendlyError = getApiErrorMessage(err);
            logInteraction(user, {
                task: 'Design Assessment',
                status: 'Error',
                durationMs: Date.now() - startTime,
                prompt: promptData,
                result: err.message,
                iteration: assessmentIteration.current,
                collaborationPattern: 'AI-assisted'
            });
            if (isMounted.current) {
                setError(friendlyError);
            }
        } finally {
            if (isMounted.current) {
                setLoading(false);
            }
        }
    });
  };
  
  const scoreLabels: { [key in keyof DesignAssessmentResult['scores']]: string } = {
      visualAppeal: "ความสวยงาม (Visual Appeal)",
      usabilityClarity: "ความชัดเจนและการใช้งาน (Usability & Clarity)",
      originality: "ความคิดสร้างสรรค์ (Originality)",
      designComposition: "องค์ประกอบด้านการออกแบบ (Composition)",
      alignmentWithGoal: "ความสอดคล้องกับเป้าหมาย (Goal Alignment)"
  };

  const renderAssessmentResult = () => {
    if (!assessmentResult) return null;

    const scores = assessmentResult.scores;
    // FIX: Cast score properties to Number to handle cases where TS infers them as `unknown`.
    const averageScore = (Number(scores.visualAppeal) + Number(scores.usabilityClarity) + Number(scores.originality) + Number(scores.alignmentWithGoal) + Number(scores.designComposition)) / 5;
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (averageScore / 10) * circumference;

    return (
      <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl animate-fade-in">
        <h3 className="text-2xl font-bold mb-6 text-cyan-400 text-center">ผลการประเมินการออกแบบ</h3>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          
          {/* Overall Score Section */}
          <div className="lg:col-span-2 flex flex-col items-center justify-center p-6 bg-slate-800/40 rounded-xl">
              <div className="relative w-40 h-40">
                  <svg className="w-full h-full" viewBox="0 0 120 120">
                      <circle
                          className="text-slate-700"
                          strokeWidth="10"
                          stroke="currentColor"
                          fill="transparent"
                          r={radius}
                          cx="60"
                          cy="60"
                      />
                      <circle
                          className="text-emerald-500"
                          strokeWidth="10"
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="transparent"
                          r={radius}
                          cx="60"
                          cy="60"
                          transform="rotate(-90 60 60)"
                          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
                      />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-4xl font-bold text-white">
                          {averageScore.toFixed(1)}
                      </span>
                  </div>
              </div>
              <h4 className="text-xl font-semibold mt-4 text-gray-200">คะแนนโดยรวม</h4>
          </div>

          {/* Details Section */}
          <div className="lg:col-span-3">
             {/* Scores Breakdown */}
            <div>
              <h4 className="text-xl font-semibold mb-4 text-gray-200">คะแนนตามเกณฑ์</h4>
              <div className="space-y-4">
                {Object.entries(assessmentResult.scores).map(([key, value]) => (
                  <div key={key}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-slate-300">{scoreLabels[key]}</span>
                      <span className="font-bold text-cyan-400">{value} / 10</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5">
                      {/* FIX: Cast `value` to Number to prevent arithmetic operation errors. */}
                      <div className="bg-gradient-to-r from-emerald-400 to-green-500 h-2.5 rounded-full" style={{ width: `${Number(value) * 10}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Feedback Breakdown */}
            <div className="mt-8">
              <h4 className="text-xl font-semibold mb-4 text-gray-200">ข้อเสนอแนะจาก AI</h4>
              <div className="space-y-4">
                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h5 className="font-bold text-green-400 mb-2">จุดแข็ง (Strengths)</h5>
                  <p className="text-slate-300 whitespace-pre-wrap">{assessmentResult.feedback.strengths}</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h5 className="font-bold text-yellow-400 mb-2">ข้อเสนอแนะเพื่อการปรับปรุง (Improvements)</h5>
                  <p className="text-slate-300 whitespace-pre-wrap">{assessmentResult.feedback.improvements}</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>
    );
  };

  return (
    <div className="container mx-auto p-4 space-y-8 animate-fade-in">
      <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-cyan-400">ประเมินผลงานการออกแบบ (Design Assessment)</h2>
            <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <span>หน้าหลัก</span>
            </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <div className="space-y-4">
             <input type="text" value={designConcept} onChange={(e) => setDesignConcept(e.target.value)} placeholder="แนวคิดการออกแบบ" className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
             <input type="text" value={designAudience} onChange={(e) => setDesignAudience(e.target.value)} placeholder="กลุ่มเป้าหมาย" className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
             <input type="text" value={designGoal} onChange={(e) => setDesignGoal(e.target.value)} placeholder="เป้าหมายของการออกแบบ" className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
          </div>
          <div className="flex flex-col bg-slate-800/40 rounded-lg p-4 space-y-4">
             {designImages.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {designImages.map((image, index) => (
                        <div key={index} className="relative group aspect-square">
                            <img src={URL.createObjectURL(image.file)} alt={`Preview ${index + 1}`} className="w-full h-full object-cover rounded-md" />
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleRemoveImage(index)} className="text-white bg-red-600 hover:bg-red-700 rounded-full p-1.5" aria-label={`ลบรูปภาพ ${index + 1}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
             <div className="border-2 border-dashed border-slate-600 hover:border-cyan-400 transition-colors rounded-lg p-4 text-center">
                 <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                 <label htmlFor="file-upload" className="cursor-pointer text-cyan-400 hover:text-cyan-300 font-semibold">
                     <span>{designImages.length > 0 ? 'เพิ่มรูปภาพ' : 'อัปโหลดรูปภาพ'}</span>
                     <input id="file-upload" name="file-upload" type="file" className="sr-only" accept="image/png, image/jpeg, image/webp, image/heic, image/heif, image/*" onChange={handleImageChange} multiple />
                 </label>
                 <p className="text-xs text-slate-500 mt-1">สามารถเลือกได้หลายไฟล์</p>
            </div>
          </div>
        </div>
        <button onClick={handleAssessDesign} disabled={loading} className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-10">
          {loading ? <div className="loader !w-6 !h-6 !border-2"></div> : 'ประเมินงานออกแบบ'}
        </button>
        {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
      </section>
      
      {renderAssessmentResult()}

    </div>
  );
};

const UserGuideModule = ({ onGoHome }) => {
  return (
    <div className="container mx-auto p-4 space-y-8 animate-fade-in">
      <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-cyan-400">คู่มือการใช้งานแอพลิเคชั่น AI Creativity Tool</h2>
            <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <span>หน้าหลัก</span>
            </button>
        </div>
        <div className="space-y-8">
            {/* Creative Corner Guide */}
            <div className="bg-slate-800/50 p-6 rounded-xl">
                <h3 className="text-xl font-bold text-cyan-400 mb-3">สร้างสรรค์ไอเดีย (Creative Corner)</h3>
                <p className="mb-4 text-slate-300">เครื่องมือนี้ช่วยระดมสมอง สร้างไอเดียสำหรับวิดีโอสั้น สร้างภาพตัวอย่าง และพัฒนาสคริปต์พร้อมถ่ายทำ</p>
                <h4 className="font-semibold text-slate-200 mb-2">ขั้นตอนการใช้งาน:</h4>
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                    <li>ไปที่หน้า "สร้างสรรค์ไอเดีย"</li>
                    <li>เลือก<strong className="text-cyan-300">หัวข้อ/ผลิตภัณฑ์</strong>จากเมนู จากนั้นกรอก<strong className="text-cyan-300">กลุ่มเป้าหมาย</strong> และ<strong className="text-cyan-300">เป้าหมายของคอนเทนต์</strong> (หากไม่มีหัวข้อที่ต้องการ สามารถเลือก 'อื่นๆ' เพื่อระบุเองได้)</li>
                    <li>กดปุ่ม <strong className="text-cyan-300">"สร้างไอเดีย"</strong> AI จะเสนอ 3 ไอเดียให้เลือก</li>
                    <li>สำหรับแต่ละไอเดีย คุณสามารถ:
                        <ul className="list-disc list-inside mt-2 ml-4 space-y-1">
                            <li><strong>สร้างภาพตัวอย่าง:</strong> กดปุ่มเพื่อสร้างภาพประกอบคอนเซ็ปต์</li>
                            <li><strong>สร้างสคริปต์:</strong> กดปุ่มเพื่อเขียนสคริปต์ถ่ายทำโดยละเอียด</li>
                            <li><strong>ฟังเสียงบรรยาย:</strong> ในตารางสคริปต์ กดไอคอนรูปลำโพงเพื่อฟังเสียงบรรยายแต่ละฉาก</li>
                            <li><strong>บันทึกสคริปต์:</strong> กดปุ่มเพื่อดาวน์โหลดสคริปต์เป็นไฟล์ .txt</li>
                        </ul>
                    </li>
                </ol>
            </div>

            {/* Speech Generation Guide */}
            <div className="bg-slate-800/50 p-6 rounded-xl">
                <h3 className="text-xl font-bold text-rose-400 mb-3">สร้างสรรค์บทพูด (Speech Generation)</h3>
                <p className="mb-4 text-slate-300">สร้างสรรค์บทพูดและสคริปต์สำหรับโอกาสต่างๆ ตั้งแต่การนำเสนอผลงานไปจนถึงสคริปต์วิดีโอ</p>
                <h4 className="font-semibold text-slate-200 mb-2">ขั้นตอนการใช้งาน:</h4>
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                    <li>ไปที่หน้า "สร้างสรรค์บทพูด"</li>
                    <li>เลือก<strong className="text-rose-300">ประเภทของบทพูด</strong>ที่ต้องการ</li>
                    <li>กรอกรายละเอียด: <strong className="text-rose-300">กลุ่มผู้ฟัง</strong>, <strong className="text-rose-300">เป้าหมาย</strong>, และ<strong className="text-rose-300">สไตล์ของผู้พูด</strong></li>
                    <li>หากต้องการระดมสมองเรื่องหัวข้อ สามารถใช้<strong className="text-rose-300">ปุ่มบันทึกเสียง</strong>เพื่อพูดไอเดีย แล้ว AI จะแปลงเป็นข้อความให้</li>
                    <li>กดปุ่ม<strong className="text-rose-300">"สร้างบทพูด"</strong> เพื่อให้ AI สร้างสรรค์ผลงาน</li>
                    <li>คุณสามารถ<strong className="text-rose-300">คัดลอก</strong>หรือ<strong className="text-rose-300">บันทึกเป็นไฟล์ .txt</strong>ได้</li>
                     <li><strong className="text-yellow-300">Tip:</strong> สามารถกดปุ่ม "ดูไอเดีย" เพื่อนำไอเดียที่บันทึกไว้จาก Creative Corner มาใช้เป็นหัวข้อได้</li>
                </ol>
            </div>

            {/* Image Generation Guide */}
            <div className="bg-slate-800/50 p-6 rounded-xl">
                <h3 className="text-xl font-bold text-amber-400 mb-3">สร้างสรรค์ภาพ (Image Generation)</h3>
                <p className="mb-4 text-slate-300">เปลี่ยนข้อความคำอธิบายให้กลายเป็นภาพที่สวยงาม สามารถใช้สร้าง Mood Board, ภาพประกอบ, หรือภาพต้นแบบได้</p>
                <h4 className="font-semibold text-slate-200 mb-2">ขั้นตอนการใช้งาน:</h4>
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                    <li>ไปที่หน้า "สร้างสรรค์ภาพ"</li>
                    <li><strong className="text-amber-300">อธิบายภาพที่ต้องการ</strong>ในกล่องข้อความ ยิ่งละเอียด ยิ่งได้ภาพที่ตรงใจ</li>
                    <li>เลือก<strong className="text-amber-300">สไตล์ภาพ</strong>ที่ต้องการ (เช่น ภาพถ่าย, ภาพวาด, 3D)</li>
                    <li>เลือก<strong className="text-amber-300">สัดส่วนภาพ</strong> (Aspect Ratio) ที่ต้องการ (เช่น 1:1 สำหรับโซเชียลมีเดีย, 16:9 สำหรับวิดีโอ)</li>
                    <li>(ทางเลือก) สามารถ<strong className="text-amber-300">แนบไฟล์รูปตัวอย่าง</strong> เพื่อให้ AI ใช้เป็นแรงบันดาลใจในการสร้างภาพใหม่ได้</li>
                    <li>กดปุ่ม<strong className="text-amber-300">"สร้างภาพ"</strong> AI จะสร้างผลงานให้ 4 แบบ (หากไม่ได้ใช้รูปตัวอย่าง)</li>
                    <li>คลิกที่ภาพที่ต้องการเพื่อดูตัวอย่างขนาดใหญ่ จากนั้นกดปุ่ม <strong className="text-amber-300">"ดาวน์โหลดภาพนี้"</strong> เพื่อบันทึกไฟล์</li>
                    <li><strong className="text-amber-300">ข้อแนะนำ:</strong> ไฟล์ที่ดาวน์โหลดจะเป็นไฟล์ภาพประเภท JPG ซึ่งเหมาะสำหรับเปิดด้วยโปรแกรมดูภาพทั่วไป (เช่น Photos บน Windows) หรือโปรแกรมแต่งภาพ (เช่น Photoshop) ไม่แนะนำให้เปิดด้วยโปรแกรมสำหรับงานเวกเตอร์ (เช่น Illustrator) เนื่องจากเป็นไฟล์คนละประเภทกัน</li>
                </ol>
            </div>

            {/* Media Assessment Guide */}
            <div className="bg-slate-800/50 p-6 rounded-xl">
                <h3 className="text-xl font-bold text-indigo-400 mb-3">ประเมินผลงานสื่อมีเดีย (Media Work Assessment)</h3>
                <p className="mb-4 text-slate-300">วิเคราะห์และให้คะแนนผลงานมีเดียประเภทต่างๆ ตามเกณฑ์มาตรฐานมืออาชีพ เพื่อหาจุดแข็งและแนวทางพัฒนา</p>
                 <h4 className="font-semibold text-slate-200 mb-2">ขั้นตอนการใช้งาน:</h4>
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                    <li>ไปที่หน้า "ประเมินผลงานสื่อมีเดีย"</li>
                    <li>เลือก <strong className="text-indigo-300">ประเภทของสื่อ</strong> จากเมนู (เช่น ภาพยนตร์, สปอตโฆษณา, ภาพถ่าย)</li>
                    <li>ระบุ <strong className="text-indigo-300">เป้าหมายของผลงาน</strong></li>
                    <li>นำผลงานที่ต้องการประเมินใส่ในระบบ โดยมี 2 วิธี:
                         <ul className="list-disc list-inside mt-2 ml-4 space-y-1">
                            <li><strong>วางข้อความ:</strong> คัดลอกสคริปต์หรือเนื้อหามาวางในกล่องข้อความ</li>
                            <li><strong>อัปโหลดไฟล์:</strong> กดปุ่ม "อัปโหลดไฟล์" เพื่อเลือกไฟล์ .txt หรือไฟล์วิดีโอ</li>
                        </ul>
                    </li>
                    <li>กดปุ่ม <strong className="text-indigo-300">"ประเมินผลงาน"</strong> AI จะแสดงผลเป็นคะแนนในแต่ละเกณฑ์ พร้อมบอกจุดแข็งและข้อเสนอแนะ</li>
                </ol>
            </div>

            {/* Design Assessment Guide */}
            <div className="bg-slate-800/50 p-6 rounded-xl">
                <h3 className="text-xl font-bold text-emerald-400 mb-3">ประเมินผลงานการออกแบบ (Design Assessment)</h3>
                <p className="mb-4 text-slate-300">ประเมินงานออกแบบภาพนิ่ง เช่น โปสเตอร์, UI, หรือชุดภาพโฆษณาตามหลักการออกแบบ</p>
                <h4 className="font-semibold text-slate-200 mb-2">ขั้นตอนการใช้งาน:</h4>
                 <ol className="list-decimal list-inside space-y-2 text-slate-300">
                    <li>ไปที่หน้า "ประเมินผลงานการออกแบบ"</li>
                    <li>กรอกข้อมูล 3 ช่อง: <strong className="text-emerald-300">แนวคิดการออกแบบ</strong>, <strong className="text-emerald-300">กลุ่มเป้าหมาย</strong>, และ <strong className="text-emerald-300">เป้าหมายของการออกแบบ</strong></li>
                    <li><strong className="text-emerald-300">อัปโหลดรูปภาพ</strong> ผลงานที่ต้องการประเมิน (สามารถอัปโหลดได้หลายภาพพร้อมกัน)</li>
                    <li>กดปุ่ม <strong className="text-emerald-300">"ประเมินงานออกแบบ"</strong> AI จะแสดงผลคะแนนโดยรวม, คะแนนตามเกณฑ์ย่อย, และข้อเสนอแนะ</li>
                </ol>
            </div>
        </div>
      </section>
    </div>
  );
};

const CreatorModule = ({ onGoHome }) => {
  const creatorImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAHgA8MDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A/fyiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigA'
return (
  <div className="container mx-auto p-4 space-y-8 animate-fade-in">
    <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl max-w-2xl mx-auto text-center">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-cyan-400">ผู้สร้างเครื่องมือ</h2>
            <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <span>หน้าหลัก</span>
            </button>
        </div>
         
         <img src={creatorImage} alt="ฐากร อยู่วิจิตร" className="w-32 h-32 rounded-full mx-auto mb-4 object-cover border-4 border-cyan-400 shadow-lg shadow-cyan-400/30" />
         
         <h2 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-transparent bg-clip-text mb-2">ฐากร อยู่วิจิตร</h2>
         <h3 className="text-lg text-slate-300 mb-1">Multimedia Technology Teacher & AI Developer</h3>
         <p className="text-md text-slate-400 mb-4">
            คณะวิทยาศาสตร์และเทคโนโลยี มหาวิทยาลัยเทคโนโลยีราชมงคลสุวรรณภูมิ
         </p>

         <div className="border-t border-slate-700 my-6"></div>

         <h4 className="text-lg font-semibold text-cyan-400 mb-2">แนวคิดในการออกแบบเครื่องมือ</h4>
         <p className="text-slate-400 mb-6 px-4">
          เครื่องมือนี้ถูกออกแบบมาเพื่อเป็นผู้ช่วยสำหรับนักสร้างสรรค์คอนเทนต์และนักออกแบบ ช่วยลดขั้นตอนการทำงานที่ซับซ้อน ตั้งแต่การระดมสมองไปจนถึงการประเมินผลงาน เพื่อให้ผู้ใช้งานสามารถมุ่งเน้นไปที่การสร้างสรรค์ผลงานที่มีคุณภาพได้อย่างเต็มที่
         </p>
         
         <div className="flex justify-center space-x-6">
            <a href="mailto:thakorn.yoo@gmail.com" className="text-slate-400 hover:text-cyan-400 hover:scale-110 transition-all" aria-label="Email">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
               </svg>
            </a>
            <a href="https://www.facebook.com/thakorn.yoo/" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-cyan-400 hover:scale-110 transition-all" aria-label="Facebook">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/>
                </svg>
            </a>
         </div>
      </section>
    </div>
  );
};

const ImageGenerationModule = ({ onGoHome, user, userSettings, updateUserSettings }) => {
    const [prompt, setPrompt] = useState('');
    const [style, setStyle] = useState(userSettings?.imageStyle || 'ภาพถ่ายสมจริง (Photorealistic)');
    const [aspectRatio, setAspectRatio] = useState(userSettings?.imageAspectRatio || '1:1');
    const [referenceImage, setReferenceImage] = useState<{ file: File, base64: string, mimeType: string } | null>(null);
    const [generatedImages, setGeneratedImages] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    const imageIteration = useRef(0);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const imageStyles = [
        'ภาพถ่ายสมจริง (Photorealistic)',
        'ภาพวาดดิจิทัล (Digital Painting)',
        'ศิลปะแนวคอนเซปต์ (Concept Art)',
        'โมเดล 3 มิติ (3D Model)',
        'ซีเนมาติก (Cinematic)',
        'ภาพถ่ายวินเทจ (Vintage Photo)',
        'มินิมอลลิสต์ (Minimalist)',
        'กราฟิกโนเวล (Graphic Novel)',
        'ภาพการ์ตูน (Cartoon)',
        'ภาพอนิเมะ (Anime)',
        'ศิลปะพิกเซล (Pixel Art)',
        'ภาพวาดสีน้ำ (Watercolor)',
        'ภาพแบบเวกเตอร์ (Vector Art)',
        'แนวไซเบอร์พังค์ (Cyberpunk)',
        'แนวแฟนตาซี (Fantasy)',
        'แนวสตีมพังค์ (Steampunk)',
        'แนวเหนือจริง (Surrealism)',
        'แนวนามธรรม (Abstract)',
        'ภาพขาว-ดำ (Black and White)',
        'ภาพวาดเส้น (Line Art)',
        'สไตล์ Isometric',
        'สไตล์ Low Poly'
    ];
    
    const aspectRatios = [
        { label: 'จัตุรัส (1:1)', value: '1:1' },
        { label: 'สตอรี่ (9:16)', value: '9:16' },
        { label: 'ไวด์สกรีน (16:9)', value: '16:9' },
        { label: 'แนวนอน (4:3)', value: '4:3' },
        { label: 'แนวตั้ง (3:4)', value: '3:4' },
    ];

    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                setError('กรุณาอัปโหลดไฟล์รูปภาพเท่านั้น');
                return;
            }
            setError('');
            try {
                const { base64, mimeType } = await blobToBase64(file);
                setReferenceImage({ file, base64, mimeType });
            } catch (err) {
                console.error(err);
                setError('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ');
            }
        }
    };

    const handleRemoveImage = () => {
        setReferenceImage(null);
    };

    const handleGenerateImage = () => {
        if (!prompt.trim() && !referenceImage) {
            setError('กรุณาอธิบายภาพที่ต้องการสร้าง หรือแนบไฟล์รูปตัวอย่าง');
            return;
        }
        setLoading(true);
        setError('');
        setGeneratedImages([]);
        imageIteration.current += 1;
        const startTime = Date.now();
        const useReferenceImage = referenceImage?.base64 && referenceImage?.mimeType;
        const promptData = {
            prompt,
            style,
            aspectRatio,
            hasReferenceImage: !!useReferenceImage,
        };

        enqueueApiRequest(async () => {
            try {
                // Logic is now clearer: if a valid reference image exists, use the image-editing model.
                // Otherwise, use the standard text-to-image model.
                if (useReferenceImage) {
                     const textPart = { text: prompt ? `สร้างภาพใหม่โดยได้รับแรงบันดาลใจจากภาพอ้างอิงนี้ ภาพใหม่ควรเกี่ยวกับ: "${prompt}" ในสไตล์ ${style}` : `สร้างภาพใหม่โดยได้รับแรงบันดาลใจจากภาพอ้างอิงนี้ ในสไตล์ ${style}` };
                    const imagePart = {
                        inlineData: {
                            data: referenceImage.base64,
                            mimeType: referenceImage.mimeType,
                        },
                    };
    
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image-preview',
                        contents: { parts: [imagePart, textPart] },
                        config: {
                            responseModalities: [Modality.IMAGE, Modality.TEXT],
                        },
                    });
    
                    let foundImage = false;
                    for (const part of response.candidates[0].content.parts) {
                        if (part.inlineData) {
                             if (isMounted.current) {
                                const base64ImageBytes = part.inlineData.data;
                                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                                setGeneratedImages([imageUrl]);
                            }
                            foundImage = true;
                            break;
                        }
                    }
                    if (isMounted.current) {
                        if (foundImage) {
                            logInteraction(user, {
                                task: 'Image Generation',
                                status: 'Success',
                                durationMs: Date.now() - startTime,
                                prompt: promptData,
                                result: '1 image generated with reference',
                                iteration: imageIteration.current,
                                collaborationPattern: 'Co-creation'
                            });
                        } else {
                             setError('AI ไม่สามารถสร้างภาพจากข้อมูลที่ให้มาได้');
                            logInteraction(user, {
                                task: 'Image Generation',
                                status: 'Failed',
                                durationMs: Date.now() - startTime,
                                prompt: promptData,
                                result: 'AI could not generate an image from the provided data.',
                                iteration: imageIteration.current,
                                collaborationPattern: 'Co-creation'
                            });
                        }
                    }
                } else {
                    if (!prompt.trim()) {
                        setError('กรุณาอธิบายภาพที่ต้องการสร้าง');
                        if (isMounted.current) setLoading(false);
                        return;
                    }
                    const fullPrompt = `${prompt}, สไตล์: ${style}.`;
                    const response = await ai.models.generateImages({
                        model: 'imagen-4.0-generate-001',
                        prompt: fullPrompt,
                        config: {
                            numberOfImages: 4,
                            outputMimeType: 'image/jpeg',
                            aspectRatio: aspectRatio,
                        },
                    });
                    if (isMounted.current) {
                        const imageUrls = response.generatedImages.map(img => `data:image/jpeg;base64,${img.image.imageBytes}`);
                        setGeneratedImages(imageUrls);
                        logInteraction(user, {
                            task: 'Image Generation',
                            status: 'Success',
                            durationMs: Date.now() - startTime,
                            prompt: promptData,
                            result: `${imageUrls.length} images generated`,
                            iteration: imageIteration.current,
                            collaborationPattern: 'Co-creation'
                        });
                    }
                }
            } catch (err) {
                console.error(err);
                const errorMessage = getApiErrorMessage(err);
                 logInteraction(user, {
                    task: 'Image Generation',
                    status: 'Error',
                    durationMs: Date.now() - startTime,
                    prompt: promptData,
                    result: err.message,
                    iteration: imageIteration.current,
                    collaborationPattern: 'Co-creation'
                });
                if (isMounted.current) {
                    setError(errorMessage);
                }
            } finally {
                if (isMounted.current) {
                    setLoading(false);
                }
            }
        });
    };
    
    const handleDownloadImage = (imageUrl: string, index: number) => {
        if (!imageUrl) return;
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `ai-generated-${Date.now()}-${index + 1}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const Lightbox = ({ imageUrl, onClose, onDownload }) => {
        if (!imageUrl) return null;
        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
                <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                    <img src={imageUrl} alt="Enlarged view" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
                    <button onClick={onClose} className="absolute -top-3 -right-3 text-white bg-slate-800/80 hover:bg-red-600 rounded-full p-2 transition-colors">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full text-center">
                         <button onClick={onDownload} className="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-2 px-6 rounded-full transition inline-flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.293a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                            <span>ดาวน์โหลดภาพนี้</span>
                        </button>
                        <p className="text-xs text-slate-400 mt-2 px-4">(ไฟล์ JPG: แนะนำให้เปิดด้วยโปรแกรมดูภาพทั่วไป ไม่ใช่ Illustrator)</p>
                    </div>
                </div>
            </div>
        );
    };


    return (
        <div className="container mx-auto p-4 space-y-8 animate-fade-in">
             <Lightbox 
                imageUrl={lightboxImage} 
                onClose={() => setLightboxImage(null)} 
                onDownload={() => lightboxImage && handleDownloadImage(lightboxImage, generatedImages.indexOf(lightboxImage))}
            />
            <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-cyan-400">สร้างสรรค์ภาพ (Image Generation)</h2>
                    <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                        </svg>
                        <span>หน้าหลัก</span>
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    {/* Left Column: Inputs */}
                    <div className="space-y-4">
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="อธิบายภาพที่ต้องการสร้าง... (เช่น 'นักบินอวกาศขี่ม้าบนดาวอังคาร')"
                            className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-24 resize-y"
                            aria-label="Image prompt"
                        />
                        <select
                            value={style}
                            onChange={(e) => {
                                setStyle(e.target.value);
                                updateUserSettings({ imageStyle: e.target.value });
                            }}
                            className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            aria-label="Image style"
                        >
                            {imageStyles.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                         {!referenceImage && (
                            <select
                                value={aspectRatio}
                                onChange={(e) => {
                                    setAspectRatio(e.target.value);
                                    updateUserSettings({ imageAspectRatio: e.target.value });
                                }}
                                className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                aria-label="Image aspect ratio"
                            >
                                {aspectRatios.map(ar => <option key={ar.value} value={ar.value}>{ar.label}</option>)}
                            </select>
                        )}
                        <div className="border-2 border-dashed border-slate-600 hover:border-cyan-400 transition-colors rounded-lg p-4 text-center">
                            {referenceImage ? (
                                <div className="relative group aspect-square max-w-[200px] mx-auto">
                                    <img src={URL.createObjectURL(referenceImage.file)} alt="Preview" className="w-full h-full object-cover rounded-md" />
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={handleRemoveImage} className="text-white bg-red-600 hover:bg-red-700 rounded-full p-1.5" aria-label="ลบรูปภาพ">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg>
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                                    <label htmlFor="ref-image-upload" className="cursor-pointer text-cyan-400 hover:text-cyan-300 font-semibold">
                                        <span>แนบไฟล์รูปตัวอย่าง</span>
                                        <input id="ref-image-upload" type="file" className="sr-only" accept="image/*" onChange={handleImageUpload} />
                                    </label>
                                    <p className="text-xs text-slate-500 mt-1">(ถ้ามี)</p>
                                </>
                            )}
                        </div>
                    </div>
                     {/* Right Column: Result */}
                     <div className="flex flex-col items-center justify-center bg-slate-800/40 rounded-lg p-4 space-y-4 min-h-[300px]">
                        {loading ? (
                             <div className="flex flex-col items-center justify-center h-full">
                                <div className="loader"></div>
                                <p className="mt-4 text-slate-400">กำลังสร้างภาพ...</p>
                            </div>
                        ) : generatedImages.length > 0 ? (
                            <div className="w-full">
                                {generatedImages.length > 1 ? (
                                    <div className="grid grid-cols-2 grid-rows-2 gap-4">
                                        {/* FIX: Add explicit types to map arguments to fix type inference issue. */}
                                        {generatedImages.map((imageUrl: string, index: number) => (
                                            <div 
                                                key={index} 
                                                className="relative group aspect-square cursor-pointer overflow-hidden rounded-md shadow-lg"
                                                onClick={() => setLightboxImage(imageUrl)}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`ดูภาพขยาย ${index + 1}`}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightboxImage(imageUrl); } }}
                                            >
                                                <img 
                                                    src={imageUrl} 
                                                    alt={`AI generated ${index + 1}`} 
                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
                                                />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 1v4m0 0h-4m4 0l-5-5" />
                                                    </svg>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div 
                                        className="relative group aspect-square cursor-pointer overflow-hidden rounded-md shadow-lg w-full max-w-sm mx-auto"
                                        onClick={() => setLightboxImage(generatedImages[0])}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`ดูภาพขยาย`}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightboxImage(generatedImages[0]); } }}
                                    >
                                        <img 
                                            src={generatedImages[0]} 
                                            alt={`AI generated 1`} 
                                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" 
                                        />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 1v4m0 0h-4m4 0l-5-5" />
                                            </svg>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                             <div className="w-full">
                                <p className="text-center text-slate-500 mb-4">ผลลัพธ์จะแสดงที่นี่</p>
                                <div className="grid grid-cols-2 grid-rows-2 gap-4">
                                    {Array.from({ length: 4 }).map((_, index) => (
                                        <div key={index} className="aspect-square bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-600 flex items-center justify-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <button onClick={handleGenerateImage} disabled={loading} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 text-white font-bold py-3 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-12">
                    {loading ? <div className="loader !w-6 !h-6 !border-2"></div> : 'สร้างภาพ'}
                </button>
                {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
            </section>
        </div>
    );
};


const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [currentPage, setCurrentPage] = useState('login');
  const [savedIdeas, setSavedIdeas] = useState<Idea[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings>({});

  useEffect(() => {
    // Check if user is already logged in from a previous session
    const storedUser = localStorage.getItem('ai-creativity-user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      setCurrentPage('welcome');
      // Load user settings
      const storedSettings = localStorage.getItem(`ai-creativity-settings-${parsedUser.email}`);
      if (storedSettings) {
        setUserSettings(JSON.parse(storedSettings));
      }
    }
     // Load saved ideas from local storage on initial app load
    const storedSavedIdeas = localStorage.getItem('saved-creative-ideas');
    if (storedSavedIdeas) {
      setSavedIdeas(JSON.parse(storedSavedIdeas));
    }
  }, []);
  
  const updateUserSettings = (newSettings: Partial<UserSettings>) => {
    if (!user || !user.email) return;
    setUserSettings(prevSettings => {
        const updatedSettings = { ...prevSettings, ...newSettings };
        localStorage.setItem(`ai-creativity-settings-${user.email}`, JSON.stringify(updatedSettings));
        return updatedSettings;
    });
  };

  const updateSavedIdeas = (newSavedIdeas: Idea[]) => {
    setSavedIdeas(newSavedIdeas);
    localStorage.setItem('saved-creative-ideas', JSON.stringify(newSavedIdeas));
  };

  const handleLogin = (userData: User) => {
    setUser(userData);
    localStorage.setItem('ai-creativity-user', JSON.stringify(userData));
    // Load settings for the new user, or reset if none exist
    const storedSettings = localStorage.getItem(`ai-creativity-settings-${userData.email}`);
    if (storedSettings) {
        setUserSettings(JSON.parse(storedSettings));
    } else {
        setUserSettings({});
    }
    setCurrentPage('welcome');
  };
  
  const handleLogout = () => {
    setUser(null);
    setUserSettings({}); // Clear settings from state
    localStorage.removeItem('ai-creativity-user');
    setCurrentPage('login');
  }

  const handleGoHome = () => {
    setCurrentPage('welcome');
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'welcome':
        return <Welcome onNavigate={setCurrentPage} />;
      case 'creativeCorner':
        return <CreativeCorner onGoHome={handleGoHome} savedIdeas={savedIdeas} setSavedIdeas={updateSavedIdeas} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings} />;
      case 'speechGeneration':
        return <SpeechGenerationModule onGoHome={handleGoHome} savedIdeas={savedIdeas} setSavedIdeas={updateSavedIdeas} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings} />;
      case 'imageGeneration':
        return <ImageGenerationModule onGoHome={handleGoHome} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings} />;
      case 'assessment':
        return <AssessmentModule onGoHome={handleGoHome} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings} />;
      case 'designAssessment':
        return <DesignAssessmentModule onGoHome={handleGoHome} user={user} />;
      case 'userGuide':
        return <UserGuideModule onGoHome={handleGoHome} />;
      case 'creator':
        return <CreatorModule onGoHome={handleGoHome} />;
      case 'login':
      default:
        return (
          <div className="min-h-screen flex items-center justify-center p-4">
            <LoginModule onLogin={handleLogin} />
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {currentPage !== 'login' && <Header onGoHome={handleGoHome} user={user?.user} onLogout={handleLogout} />}
      <main className="flex-grow">
        {renderPage()}
      </main>
      <Footer />
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);