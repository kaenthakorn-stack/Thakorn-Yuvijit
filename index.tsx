

import { GoogleGenAI, Type, Modality } from '@google/genai';
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
  dialogue: string;
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

type VideoEditingPlan = {
  structureSummary: string;
  shotList: ShotDetail[];
  additionalSuggestions: {
    music: string;
    colorGrading: string;
  };
};

type ShotDetail = {
  timecode: string;
  clipSource: string;
  visualDescription: string;
  editingNote: string;
  textGraphicSuggestion: string;
  audioSuggestion: string;
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
    // For debugging, we can log the raw error object to the console
    console.error("AI API Error:", error);

    let combinedMessage = '';

    if (error instanceof Error) {
        combinedMessage = error.message;
        // Specifically catch browser-level network errors from fetch()
        if (error.name === 'TypeError' && error.message.toLowerCase().includes('failed to fetch')) {
            return 'เกิดข้อผิดพลาดในการเชื่อมต่อเครือข่าย โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ตของคุณแล้วลองอีกครั้ง';
        }
    } else if (typeof error === 'string') {
        combinedMessage = error;
    } else if (typeof error === 'object' && error !== null) {
        // Attempt to extract a meaningful message from a potential API error object
        combinedMessage = [
            error.message,
            error.error?.message,
            // In case of complex nested errors, stringify for inspection
            JSON.stringify(error)
        ].filter(Boolean).join(' ');
    }

    const lowerCaseMessage = combinedMessage.toLowerCase();

    // 1. Quota Errors
    if (lowerCaseMessage.includes('quota') || lowerCaseMessage.includes('resource_exhausted') || lowerCaseMessage.includes('429')) {
        return 'โควต้าการใช้งาน API ถึงขีดจำกัดแล้ว โปรดรอประมาณ 1 นาทีแล้วลองอีกครั้ง';
    }

    // 2. API Key Errors
    if (lowerCaseMessage.includes('api key not valid') || lowerCaseMessage.includes('permission denied')) {
        return 'API Key ไม่ถูกต้องหรือถูกปฏิเสธการเข้าถึง โปรดติดต่อผู้ดูแลระบบ';
    }

    // 3. Invalid Response/Parsing Errors
    // These can happen if the AI doesn't return valid JSON when it's supposed to.
    if (error instanceof SyntaxError || lowerCaseMessage.includes('unexpected token') || lowerCaseMessage.includes('json parse')) {
        return 'AI ตอบกลับในรูปแบบที่ไม่คาดคิดหรือไม่สมบูรณ์ ทำให้ไม่สามารถประมวลผลได้ โปรดลองอีกครั้ง';
    }
    
    // 4. Content safety blocking
    if (lowerCaseMessage.includes('finishreason: safety') || lowerCaseMessage.includes('safety policy')) {
        return 'คำขอของคุณถูกบล็อกเนื่องจากนโยบายความปลอดภัย โปรดปรับเปลี่ยนคำสั่งของคุณ';
    }
    
    // 5. General Network/Server errors (if not caught by TypeError above)
    if (lowerCaseMessage.includes('network error') || lowerCaseMessage.includes('server error') || lowerCaseMessage.includes('500')) {
        return 'เซิร์ฟเวอร์ AI เกิดข้อผิดพลาดชั่วคราว โปรดลองอีกครั้งในภายหลัง';
    }

    // 6. Generic fallback error
    // This is a catch-all for anything not identified above.
    return 'เกิดข้อผิดพลาดที่ไม่คาดคิดในการสื่อสารกับ AI โปรดลองอีกครั้งในภายหลัง';
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

  useEffect(() => {
    // Pre-fill the form with the last logged-in user's details for convenience
    const lastUser = localStorage.getItem('ai-creativity-last-user');
    if (lastUser) {
      try {
        const userData: User = JSON.parse(lastUser);
        if (userData && userData.user && userData.email) {
          setUser(userData.user);
          setEmail(userData.email);
        }
      } catch (e) {
        console.error("Failed to parse last user data:", e);
      }
    }
  }, []); // Run only once on mount

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
            <button
                onClick={() => onNavigate('videoEditorAssistant')}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:shadow-purple-500/30 text-white font-bold py-3 px-8 rounded-full text-lg transition-all transform hover:scale-105 hover:-translate-y-1 shadow-lg"
            >
                ผู้ช่วยตัดต่อวิดีโอ
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
            const prompt = `คุณคือผู้กำกับและนักเขียนบทมืออาชีพ สร้างสคริปต์สำหรับถ่ายทำวิดีโอสั้นที่มีรายละเอียดสูงและนำไปใช้งานได้จริง จากข้อมูลไอเดียต่อไปนี้ โดยให้ผลลัพธ์ทั้งหมดเป็นภาษาไทย
            - ชื่อคอนเซ็ปต์: "${idea.conceptName}"
            - ฮุค: "${idea.hook}"
            - พล็อตเรื่อง: "${idea.shortPlot}"
            - แนวทางภาพและเสียง: "${idea.visualAudioDirection}"
            
            สร้างสคริปต์ที่สมบูรณ์ โดยผลลัพธ์ต้องเป็น JSON array ของแต่ละฉาก แต่ละฉากต้องมีข้อมูลครบถ้วนดังนี้:
            - scene: หมายเลขฉาก (Scene Number)
            - shot: หมายเลขช็อต (Shot Number)
            - cameraAngle: มุมกล้องอย่างละเอียด (เช่น Close-up, Medium Shot, Long Shot, POV)
            - cameraMovement: การเคลื่อนกล้อง (เช่น Pan, Tilt, Zoom in, Static)
            - visualDescription: คำอธิบายภาพที่ชัดเจน บอกเล่าการกระทำ, การแสดงออกของตัวละคร, และสภาพแวดล้อม
            - audio: คำอธิบายเสียงประกอบที่เจาะจง (เช่น "เสียงลมพัดเบาๆ", "ดนตรีประกอบแนว Lo-fi จังหวะสบายๆ")
            - dialogue: บทพูดที่ตัวละครพูดจริงๆ (หากไม่มีบทพูด ให้ระบุว่า "ไม่มี")
            - approxDuration: ระยะเวลาโดยประมาณของช็อต (เช่น "3 วินาที")`;
            
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
                                audio: { type: Type.STRING, description: "เสียงประกอบ เช่น SFX, ดนตรี" },
                                dialogue: { type: Type.STRING, description: "บทพูดของตัวละคร" },
                                approxDuration: { type: Type.STRING },
                            },
                            required: ['scene', 'shot', 'cameraAngle', 'cameraMovement', 'visualDescription', 'audio', 'dialogue', 'approxDuration'],
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

    const textToSpeak = `ภาพ: ${scene.visualDescription}. เสียง: ${scene.audio}. บทพูด: ${scene.dialogue}`;
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
        fileContent += `Dialogue: ${scene.dialogue}\n`;
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
                  <div key={index} className={`bg-slate-800/50 p-4 rounded-xl transition-all duration-300 ${playingSceneIndex === index ? 'bg-cyan-900/50 ring-2 ring-cyan-500 shadow-lg shadow-cyan-500/20' : 'border border-slate-700'}`}>
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h4 className="text-lg font-bold text-cyan-400 tracking-wide">
                          SCENE {scene.scene}
                        </h4>
                        <div className="mt-1 text-xs font-mono text-slate-400 space-x-2">
                          <span className="bg-slate-700/50 px-2 py-1 rounded">SHOT: {scene.shot}</span>
                          <span className="bg-slate-700/50 px-2 py-1 rounded">TIME: {scene.approxDuration}</span>
                        </div>
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
                    <div className="mt-4 border-t border-slate-700 pt-4 space-y-4 text-sm">
                      {/* Visual Description */}
                      <div className="flex items-start gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Visual</p>
                          <p className="text-slate-300 mt-1">{scene.visualDescription}</p>
                        </div>
                      </div>

                      {/* Audio Cues */}
                      <div className="flex items-start gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-fuchsia-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clipRule="evenodd" />
                          <path d="M16.071 5.071a1 1 0 011.414 0 5.98 5.98 0 010 9.858 1 1 0 11-1.414-1.414 3.98 3.98 0 000-7.03z" />
                        </svg>
                        <div className="flex-1">
                          <p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Audio</p>
                          <p className="text-slate-300 mt-1">{scene.audio}</p>
                        </div>
                      </div>

                       {/* Dialogue */}
                      {scene.dialogue && scene.dialogue.trim().toLowerCase() !== 'ไม่มี' && (
                        <div className="flex items-start gap-3">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-teal-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z" clipRule="evenodd" />
                          </svg>
                          <div className="flex-1">
                            <p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Dialogue</p>
                            <p className="text-slate-300 mt-1 italic">"{scene.dialogue}"</p>
                          </div>
                        </div>
                      )}

                      {/* Camera Details */}
                      <div className="flex items-start gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Camera</p>
                          <div className="mt-1 font-mono text-amber-300/80 text-xs space-x-4 bg-slate-900/50 p-2 rounded-md inline-block">
                            <span>Angle: {scene.cameraAngle}</span>
                            <span className="border-l border-slate-600 pl-4">Movement: {scene.cameraMovement}</span>
                          </div>
                        </div>
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
// FIX: The following lines were causing type errors due to potential ambiguity after JSON.parse.
// Replaced the manual summation of properties with a more robust and type-safe method using Object.values and reduce.
    const averageScore = (Object.values(scores).reduce((a, b) => a + b, 0)) / 5;
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
{/* FIX: Replaced Object.entries with a typed Object.keys mapping.
This resolves a type inference issue where the 'value' from Object.entries was not being correctly identified as a number, causing an error in the arithmetic operation for the width style. */}
                {(Object.keys(scores) as Array<keyof typeof scores>).map((key) => (
                  <div key={key}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-slate-300">{scoreLabels[key]}</span>
                      <span className="font-bold text-cyan-400">{scores[key]} / 10</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2.5">
                      <div className="bg-gradient-to-r from-emerald-400 to-green-500 h-2.5 rounded-full" style={{ width: `${scores[key] * 10}%` }}></div>
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
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
             )}
             <label htmlFor="design-upload" className="cursor-pointer w-full border-2 border-dashed border-slate-600 hover:border-cyan-500 transition-colors rounded-lg p-6 flex flex-col items-center justify-center text-center text-slate-400">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                 </svg>
                 <span className="font-semibold">อัปโหลดรูปภาพ</span>
                 <span className="text-xs mt-1">สามารถเลือกได้หลายไฟล์</span>
             </label>
             <input id="design-upload" type="file" className="hidden" accept="image/*" multiple onChange={handleImageChange} />
          </div>
        </div>
         <button onClick={handleAssessDesign} disabled={loading} className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-10">
          {loading ? <div className="loader !w-6 !h-6 !border-2"></div> : 'ประเมินผลงานออกแบบ'}
        </button>
        {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
      </section>

      {renderAssessmentResult()}
    </div>
  );
};

const VideoEditorAssistantModule = ({ onGoHome, user }) => {
    const [videoFiles, setVideoFiles] = useState<{ file: File, url: string }[]>([]);
    const [goal, setGoal] = useState('');
    const [audience, setAudience] = useState('');
    const [mood, setMood] = useState('');
    const [editingStyle, setEditingStyle] = useState('');
    const [plan, setPlan] = useState<VideoEditingPlan | null>(null);
    const [loading, setLoading] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const [error, setError] = useState('');
    const planIteration = useRef(0);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        // Clean up object URLs on unmount
        return () => {
            isMounted.current = false;
            videoFiles.forEach(vf => URL.revokeObjectURL(vf.url));
        };
    }, [videoFiles]);

    const extractFramesFromVideo = (videoFile: File, maxFrames = 5): Promise<{ base64: string, mimeType: string }[]> => {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            const videoUrl = URL.createObjectURL(videoFile);
            video.src = videoUrl;
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const frames: { base64: string, mimeType: string }[] = [];

            video.onloadeddata = async () => {
                const duration = video.duration;
                if (duration === 0 || !isFinite(duration)) {
                    URL.revokeObjectURL(videoUrl);
                    reject(new Error("ไม่สามารถอ่านระยะเวลาของวิดีโอได้"));
                    return;
                }
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const interval = duration / maxFrames;

                for (let i = 0; i < maxFrames; i++) {
                    const time = i * interval + 0.1; // Add small offset to avoid issues at time 0
                    video.currentTime = Math.min(time, duration);
                    await new Promise(r => { video.onseeked = r; video.oncanplay = r; });

                    context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    const base64 = dataUrl.split(',')[1];
                    frames.push({ base64, mimeType: 'image/jpeg' });
                }
                URL.revokeObjectURL(videoUrl);
                resolve(frames);
            };
            video.onerror = (e) => {
                console.error("Video error event:", e);
                let userMessage = "เกิดข้อผิดพลาดในการโหลดวิดีโอ";
                if (video.error) {
                    console.error("Video Error Details:", video.error);
                    switch (video.error.code) {
                        case video.error.MEDIA_ERR_DECODE:
                            userMessage = "ไม่สามารถถอดรหัสวิดีโอได้ ไฟล์อาจเสียหายหรือใช้รูปแบบ (codec) ที่เบราว์เซอร์ไม่รองรับ";
                            break;
                        case video.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                            userMessage = "รูปแบบวิดีโอไม่รองรับ โปรดลองใช้วิดีโอในรูปแบบ MP4 หรือ WebM";
                            break;
                        case video.error.MEDIA_ERR_NETWORK:
                            userMessage = "เกิดข้อผิดพลาดเกี่ยวกับเครือข่ายขณะโหลดวิดีโอ";
                            break;
                        case video.error.MEDIA_ERR_ABORTED:
                             userMessage = "การโหลดวิดีโอถูกยกเลิก";
                             break;
                        default:
                            userMessage = `เกิดข้อผิดพลาดที่ไม่รู้จัก: ${video.error.message || 'โปรดลองใช้ไฟล์อื่น'}`;
                    }
                }
                URL.revokeObjectURL(videoUrl);
                reject(new Error(userMessage));
            };
        });
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files) {
            const newVideoFiles = Array.from(files)
                .filter(file => file.type.startsWith('video/'))
                .map(file => ({ file, url: URL.createObjectURL(file) }));

            if (files.length > 0 && newVideoFiles.length === 0) {
                 setError("ไฟล์ที่เลือกไม่ใช่วิดีโอ");
            } else {
                 setError('');
                 setVideoFiles(prev => [...prev, ...newVideoFiles]);
            }
        }
    };

    const handleRemoveVideo = (indexToRemove: number) => {
        setVideoFiles(prev => {
            const newFiles = [...prev];
            const removed = newFiles.splice(indexToRemove, 1);
            URL.revokeObjectURL(removed[0].url);
            return newFiles;
        });
    };

    const handleGeneratePlan = () => {
        if (videoFiles.length === 0 || !goal.trim() || !audience.trim() || !mood.trim()) {
            setError('กรุณาอัปโหลดวิดีโอและกรอกข้อมูลให้ครบทุกช่อง');
            return;
        }
        setLoading(true);
        setProcessingMessage('กำลังประมวลผลวิดีโอ...');
        setError('');
        setPlan(null);
        planIteration.current += 1;
        const startTime = Date.now();
        const promptData = { goal, audience, mood, editingStyle, fileNames: videoFiles.map(f => f.file.name) };

        enqueueApiRequest(async () => {
            try {
                const allFramesPromises = videoFiles.map(vf => extractFramesFromVideo(vf.file));
                const framesByVideo = await Promise.all(allFramesPromises);
                
                if (!isMounted.current) return;
                setProcessingMessage('AI กำลังวางแผนการตัดต่อ...');

                const prompt = `คุณคือผู้กำกับและนักตัดต่อวิดีโอผู้เชี่ยวชาญ สร้างแผนการตัดต่อวิดีโอ (Editing Plan) จากคลิปวิดีโอที่แนบมาและข้อมูลต่อไปนี้ โดยให้ผลลัพธ์ทั้งหมดเป็นภาษาไทย
                - เป้าหมายของวิดีโอ: "${goal}"
                - กลุ่มเป้าหมาย: "${audience}"
                - อารมณ์/โทนของวิดีโอ: "${mood}"
                - แนวทาง/สไตล์การตัดต่อ (ถ้ามี): "${editingStyle || 'AI เลือกให้เหมาะสม'}"
                
                โปรดวิเคราะห์เฟรมภาพจากคลิปวิดีโอต่าง ๆ (ระบุตามชื่อไฟล์) และสร้างแผนการตัดต่อที่ละเอียด มีการลำดับเรื่องราวที่น่าสนใจ, แนะนำจังหวะการตัด, ข้อความ/กราฟิก, และเสียงประกอบ

                โปรดตอบกลับเป็นรูปแบบ JSON เท่านั้น`;
                
                let contentParts: any[] = [{ text: prompt }];
                framesByVideo.forEach((frames, index) => {
                    const fileName = videoFiles[index].file.name;
                    contentParts.push({ text: `\n\n[เริ่มต้นเฟรมจากไฟล์: ${fileName}]` });
                    frames.forEach(frame => {
                        contentParts.push({ inlineData: { data: frame.base64, mimeType: frame.mimeType } });
                    });
                    contentParts.push({ text: `[สิ้นสุดเฟรมจากไฟล์: ${fileName}]` });
                });

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: contentParts },
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                structureSummary: { type: Type.STRING, description: "สรุปโครงสร้างและการเล่าเรื่องโดยรวม" },
                                shotList: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            timecode: { type: Type.STRING, description: "ช่วงเวลาโดยประมาณ เช่น 0:00-0:05" },
                                            clipSource: { type: Type.STRING, description: "ชื่อไฟล์คลิปต้นฉบับที่ใช้" },
                                            visualDescription: { type: Type.STRING, description: "คำอธิบายภาพในช็อตนี้" },
                                            editingNote: { type: Type.STRING, description: "คำแนะนำการตัดต่อ, จังหวะ, transition" },
                                            textGraphicSuggestion: { type: Type.STRING, description: "ข้อความหรือกราฟิกที่แนะนำ (ถ้ามี)" },
                                            audioSuggestion: { type: Type.STRING, description: "คำแนะนำด้านเสียง, เพลง, หรือ SFX" }
                                        },
                                        required: ['timecode', 'clipSource', 'visualDescription', 'editingNote', 'textGraphicSuggestion', 'audioSuggestion']
                                    }
                                },
                                additionalSuggestions: {
                                    type: Type.OBJECT,
                                    properties: {
                                        music: { type: Type.STRING, description: "แนวเพลงหรือดนตรีประกอบที่แนะนำ" },
                                        colorGrading: { type: Type.STRING, description: "คำแนะนำการปรับแก้สี (Color Grading)" }
                                    },
                                    required: ['music', 'colorGrading']
                                }
                            },
                            required: ['structureSummary', 'shotList', 'additionalSuggestions']
                        }
                    }
                });

                if (isMounted.current) {
                    const result = JSON.parse(response.text) as VideoEditingPlan;
                    setPlan(result);
                    logInteraction(user, {
                        task: 'Video Editing Plan Generation',
                        status: 'Success',
                        durationMs: Date.now() - startTime,
                        prompt: promptData,
                        result: result,
                        iteration: planIteration.current,
                        collaborationPattern: 'AI-assisted'
                    });
                }

            } catch (err) {
                console.error(err);
                const friendlyError = getApiErrorMessage(err);
                logInteraction(user, {
                    task: 'Video Editing Plan Generation',
                    status: 'Error',
                    durationMs: Date.now() - startTime,
                    prompt: promptData,
                    result: err.message,
                    iteration: planIteration.current,
                    collaborationPattern: 'AI-assisted'
                });
                if (isMounted.current) {
                    setError(friendlyError);
                }
            } finally {
                if (isMounted.current) {
                    setLoading(false);
                    setProcessingMessage('');
                }
            }
        });
    };

    return (
        <div className="container mx-auto p-4 space-y-8 animate-fade-in">
            <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-cyan-400">ผู้ช่วยตัดต่อวิดีโอ (Video Editor Assistant)</h2>
                    <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                        </svg>
                        <span>หน้าหลัก</span>
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div className="space-y-4">
                        <input type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="เป้าหมายของวิดีโอ" className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                        <input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="กลุ่มเป้าหมาย" className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                        <select value={mood} onChange={(e) => setMood(e.target.value)} className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500">
                            <option value="" disabled>-- เลือกอารมณ์/โทนของวิดีโอ --</option>
                            <option value="สนุกสนาน / ร่าเริง">สนุกสนาน / ร่าเริง</option>
                            <option value="ตื่นเต้น / เร้าใจ">ตื่นเต้น / เร้าใจ</option>
                            <option value="อบอุ่น / ซึ้งใจ">อบอุ่น / ซึ้งใจ</option>
                            <option value="สงบ / ผ่อนคลาย">สงบ / ผ่อนคลาย</option>
                            <option value="ลึกลับ / น่าค้นหา">ลึกลับ / น่าค้นหา</option>
                            <option value="จริงจัง / เป็นทางการ">จริงจัง / เป็นทางการ</option>
                            <option value="ดราม่า / เข้มข้น">ดราม่า / เข้มข้น</option>
                            <option value="สร้างแรงบันดาลใจ">สร้างแรงบันดาลใจ</option>
                            <option value="ตลกขบขัน">ตลกขบขัน</option>
                        </select>
                        <select value={editingStyle} onChange={(e) => setEditingStyle(e.target.value)} className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500">
                            <option value="">AI เลือกให้เหมาะสม (แนะนำ)</option>
                            <option value="ตัดต่อเร็ว / กระชับ">ตัดต่อเร็ว / กระชับ (Fast-paced)</option>
                            <option value="ตัดต่อช้า / ละมุน">ตัดต่อช้า / ละมุน (Cinematic)</option>
                            <option value="สไตล์สารคดี">สไตล์สารคดี (Documentary)</option>
                            <option value="สไตล์ Vlog">สไตล์ Vlog</option>
                            <option value="เน้นกราฟิกและเอฟเฟกต์">เน้นกราฟิกและเอฟเฟกต์ (Motion Graphics)</option>
                            <option value="เรียบง่าย / มินิมอล">เรียบง่าย / มินิมอล (Minimalist)</option>
                            <option value="สไตล์วินเทจ / ย้อนยุค">สไตล์วินเทจ / ย้อนยุค (Vintage)</option>
                        </select>
                    </div>
                    <div className="flex flex-col bg-slate-800/40 rounded-lg p-4 space-y-4">
                        {videoFiles.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-48 overflow-y-auto">
                                {videoFiles.map((vf, index) => (
                                    <div key={index} className="relative group aspect-video">
                                        <video src={vf.url} className="w-full h-full object-cover rounded-md bg-black" />
                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-1">
                                            <button onClick={() => handleRemoveVideo(index)} className="text-white bg-red-600 hover:bg-red-700 rounded-full p-1.5" aria-label={`ลบคลิป ${index + 1}`}>
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                            <p className="text-white text-xs mt-1 text-center truncate w-full" title={vf.file.name}>{vf.file.name}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <label htmlFor="video-upload" className="cursor-pointer w-full border-2 border-dashed border-slate-600 hover:border-cyan-500 transition-colors rounded-lg p-6 flex flex-col items-center justify-center text-center text-slate-400">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" viewBox="0 0 20 20" fill="currentColor">
                               <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 001.553.832l3-2a1 1 0 000-1.664l-3-2z" />
                             </svg>
                             <span className="font-semibold">อัปโหลดคลิปวิดีโอ</span>
                             <span className="text-xs mt-1">สามารถเลือกได้หลายไฟล์</span>
                        </label>
                        <p className="text-xs text-slate-500 text-center -mt-3">แนะนำ: ใช้ไฟล์ MP4 เพื่อความเข้ากันได้สูงสุด</p>
                        <input id="video-upload" type="file" className="hidden" accept="video/*" multiple onChange={handleFileChange} />
                    </div>
                </div>
                <button onClick={handleGeneratePlan} disabled={loading} className="w-full bg-gradient-to-r from-purple-500 to-pink-600 hover:opacity-90 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-10">
                    {loading ? <div className="flex items-center gap-2"><div className="loader !w-6 !h-6 !border-2"></div><span>{processingMessage}</span></div> : 'ให้ AI แนะนำการตัดต่อ'}
                </button>
                {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
            </section>
            
            {plan && (
                <section className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 rounded-2xl shadow-xl animate-fade-in space-y-6">
                    <div>
                        <h3 className="text-2xl font-bold text-cyan-400 mb-2">แผนการตัดต่อโดย AI</h3>
                        <p className="text-slate-300 bg-slate-800/50 p-4 rounded-lg">{plan.structureSummary}</p>
                    </div>
                    <div className="space-y-4">
                        {plan.shotList.map((shot, index) => (
                            <div key={index} className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                                <h4 className="text-lg font-bold text-cyan-400 tracking-wide">
                                    {shot.timecode} <span className="text-sm font-normal text-slate-400">(จาก: {shot.clipSource})</span>
                                </h4>
                                <div className="mt-4 border-t border-slate-700 pt-4 space-y-4 text-sm">
                                     <div className="flex items-start gap-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                                        <div><p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Visual</p><p className="text-slate-300 mt-1">{shot.visualDescription}</p></div>
                                    </div>
                                     <div className="flex items-start gap-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 01-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                        <div><p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Editing</p><p className="text-slate-300 mt-1">{shot.editingNote}</p></div>
                                    </div>
                                    {shot.textGraphicSuggestion.toLowerCase() !== 'ไม่มี' && shot.textGraphicSuggestion.trim() !== '' && (
                                     <div className="flex items-start gap-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.243 3.03a1 1 0 01.757 1.628L6.002 10l3.998 5.342A1 1 0 018.998 17H6a1 1 0 01-.928-.629l-4-8A1 1 0 012 7h2.236a1 1 0 01.928.629L6.002 10l2.24-2.987a1 1 0 011.001-.353zM14 7a1 1 0 011 1v4a1 1 0 11-2 0V8a1 1 0 011-1z" clipRule="evenodd" /></svg>
                                        <div><p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Text/Graphics</p><p className="text-slate-300 mt-1">{shot.textGraphicSuggestion}</p></div>
                                    </div>
                                    )}
                                     <div className="flex items-start gap-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-fuchsia-400 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clipRule="evenodd" /><path d="M16.071 5.071a1 1 0 011.414 0 5.98 5.98 0 010 9.858 1 1 0 11-1.414-1.414 3.98 3.98 0 000-7.03z" /></svg>
                                        <div><p className="font-semibold text-slate-300 uppercase tracking-wider text-xs">Audio</p><p className="text-slate-300 mt-1">{shot.audioSuggestion}</p></div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-cyan-400 mb-2">ข้อเสนอแนะเพิ่มเติม</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div className="bg-slate-800/50 p-4 rounded-lg">
                              <h5 className="font-bold text-green-400 mb-2">ดนตรีและเสียงประกอบ</h5>
                              <p className="text-slate-300 whitespace-pre-wrap">{plan.additionalSuggestions.music}</p>
                            </div>
                            <div className="bg-slate-800/50 p-4 rounded-lg">
                              <h5 className="font-bold text-yellow-400 mb-2">การปรับแก้สี (Color Grading)</h5>
                              <p className="text-slate-300 whitespace-pre-wrap">{plan.additionalSuggestions.colorGrading}</p>
                            </div>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
};

const ImageGenerationModule = ({ onGoHome, user, userSettings, updateUserSettings }) => {
    const [prompt, setPrompt] = useState('');
    const [style, setStyle] = useState(userSettings?.imageStyle || 'สมจริง');
    const [aspectRatio, setAspectRatio] = useState(userSettings?.imageAspectRatio || '1:1');
    const [numberOfImages, setNumberOfImages] = useState(1);
    const [generatedImages, setGeneratedImages] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const imageIteration = useRef(0);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const handleGenerateImages = () => {
        if (!prompt.trim()) {
            setError('กรุณาใส่คำสั่งเพื่อสร้างภาพ');
            return;
        }
        setError('');
        setLoading(true);
        setGeneratedImages([]);
        imageIteration.current += 1;
        const startTime = Date.now();
        const fullPrompt = `${prompt}, สไตล์ ${style}`;
        const promptData = { prompt, style, aspectRatio, numberOfImages };

        enqueueApiRequest(async () => {
            try {
                const response = await ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: fullPrompt,
                    config: {
                        numberOfImages: numberOfImages,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: aspectRatio as "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
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
                        collaborationPattern: 'AI-assisted'
                    });
                }
            } catch (err) {
                console.error(err);
                const friendlyError = getApiErrorMessage(err);
                logInteraction(user, {
                    task: 'Image Generation',
                    status: 'Error',
                    durationMs: Date.now() - startTime,
                    prompt: promptData,
                    result: err.message,
                    iteration: imageIteration.current,
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
    
    const handleDownloadImage = (imageUrl: string, index: number) => {
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `ai_generated_image_${index + 1}.jpeg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="container mx-auto p-4 space-y-8 animate-fade-in">
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
                <div className="space-y-4 mb-4">
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="ใส่คำสั่ง (prompt) เพื่อสร้างภาพ... (เช่น 'นักบินอวกาศกำลังขี่ม้าบนดาวอังคาร')"
                        className="w-full bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-28 resize-y"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <select 
                            value={style} 
                            onChange={e => {
                                setStyle(e.target.value);
                                updateUserSettings({ imageStyle: e.target.value });
                            }} 
                            className="bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        >
                            <optgroup label="สไตล์ภาพถ่าย">
                                <option value="สมจริง">สมจริง (Photorealistic)</option>
                                <option value="ภาพฟิล์ม">ภาพฟิล์ม (Analog Film)</option>
                                <option value="ภาพถ่ายขาว-ดำ">ภาพถ่ายขาว-ดำ (Black & White)</option>
                                <option value="ซีเนมาติก">ซีเนมาติก (Cinematic)</option>
                            </optgroup>
                            <optgroup label="สไตล์ภาพวาดและศิลปะ">
                                <option value="ภาพวาดสีน้ำมัน">ภาพวาดสีน้ำมัน (Oil Painting)</option>
                                <option value="ภาพวาดลายเส้น">ภาพวาดลายเส้น (Line Art)</option>
                                <option value="ศิลปะแนวแฟนตาซี">แฟนตาซี (Fantasy)</option>
                                <option value="ศิลปะแนวไซเบอร์พังค์">ไซเบอร์พังค์ (Cyberpunk)</option>
                                <option value="แนวคอนเซปต์อาร์ต">คอนเซปต์อาร์ต (Concept art)</option>
                                <option value="สไตล์การ์ตูน">การ์ตูน (Cartoon)</option>
                                <option value="สีน้ำ">สีน้ำ (Watercolor)</option>
                            </optgroup>
                            <optgroup label="สไตล์แอนิเมชัน">
                                 <option value="อนิเมะ">อนิเมะ (Anime)</option>
                                 <option value="พิกซาร์">พิกซาร์ (Pixar)</option>
                                 <option value="ดิสนีย์">ดิสนีย์ (Disney)</option>
                            </optgroup>
                            <optgroup label="สไตล์กราฟิกและโมเดล">
                                <option value="แบบจำลอง 3 มิติ">แบบจำลอง 3 มิติ (3D Model)</option>
                                <option value="ไอโซเมตริก">ไอโซเมตริก (Isometric)</option>
                                <option value="โลว์โพลี">โลว์โพลี (Low Poly)</option>
                                <option value="ศิลปะพิกเซล">ศิลปะพิกเซล (Pixel Art)</option>
                                <option value="เวคเตอร์">เวคเตอร์ (Vector Art)</option>
                                <option value="สถาปัตยกรรม">สถาปัตยกรรม (Architectural)</option>
                            </optgroup>
                            <optgroup label="สไตล์งานฝีมือ">
                                <option value="โอริกามิ">โอริกามิ (Origami)</option>
                                <option value="ดินปั้น">ดินปั้น (Craft Clay)</option>
                            </optgroup>
                        </select>
                         <select 
                            value={aspectRatio} 
                            onChange={e => {
                                setAspectRatio(e.target.value);
                                updateUserSettings({ imageAspectRatio: e.target.value });
                            }} 
                            className="bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        >
                            <option value="1:1">จัตุรัส (1:1)</option>
                            <option value="16:9">แนวนอน (16:9)</option>
                            <option value="9:16">แนวตั้ง (9:16)</option>
                            <option value="4:3">แนวนอน 4:3</option>
                            <option value="3:4">แนวตั้ง 3:4</option>
                        </select>
                        <select value={numberOfImages} onChange={e => setNumberOfImages(Number(e.target.value))} className="bg-slate-800 p-3 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500">
                            <option value={1}>1 ภาพ</option>
                            <option value={2}>2 ภาพ</option>
                            <option value={3}>3 ภาพ</option>
                            <option value={4}>4 ภาพ</option>
                        </select>
                    </div>
                </div>
                <button onClick={handleGenerateImages} disabled={loading} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 text-white font-bold py-3 px-4 rounded-lg transition disabled:bg-slate-600 flex items-center justify-center h-12">
                    {loading ? <div className="loader !w-6 !h-6 !border-2"></div> : 'สร้างภาพ'}
                </button>
                {error && <p className="text-red-400 mt-2 text-center">{error}</p>}
            </section>
            
            {loading && (
                <div className="text-center p-8">
                    <div className="loader mx-auto"></div>
                    <p className="mt-4 text-slate-400">AI กำลังสร้างสรรค์ผลงาน... โปรดรอสักครู่</p>
                </div>
            )}

            {generatedImages.length > 0 && (
                <section className="animate-fade-in">
                    <h3 className="text-2xl font-bold mb-4 text-center">ภาพที่สร้างโดย AI</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {generatedImages.map((image, index) => (
                            <div 
                                key={index} 
                                className="group relative bg-slate-800 rounded-lg overflow-hidden shadow-lg border border-slate-700 cursor-pointer"
                                onClick={() => setSelectedImage(image)}
                            >
                                <img src={image} alt={`Generated image ${index + 1}`} className="w-full h-full object-contain" />
                                <div className="absolute inset-0 bg-black/70 flex flex-col gap-2 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-4 text-center">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation(); // Prevent modal from opening when clicking download
                                            handleDownloadImage(image, index);
                                        }}
                                        className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-transform transform hover:scale-105 flex items-center space-x-2"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.293a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                        <span>ดาวน์โหลด</span>
                                    </button>
                                     <p className="text-xs text-slate-300">คลิกที่ภาพเพื่อดูขนาดใหญ่</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {selectedImage && (
                <div 
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" 
                    onClick={() => setSelectedImage(null)}
                    aria-modal="true"
                    role="dialog"
                >
                    <div 
                        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col" 
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img 
                            src={selectedImage} 
                            alt="Enlarged view of generated image" 
                            className="w-full h-auto object-contain max-h-[calc(90vh-6rem)] rounded-lg border border-slate-700" 
                        />
                        
                        <button 
                            onClick={() => setSelectedImage(null)} 
                            className="absolute -top-2 -right-2 text-slate-300 bg-slate-800 hover:bg-slate-700/80 rounded-full p-2 transition-colors shadow-lg"
                            aria-label="Close image viewer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        <div className="text-center mt-4">
                             <button
                                onClick={() => {
                                    const imageIndex = generatedImages.findIndex(img => img === selectedImage);
                                    if (imageIndex !== -1) {
                                        handleDownloadImage(selectedImage, imageIndex);
                                    }
                                }}
                                className="bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold py-2 px-6 rounded-lg transition-transform transform hover:scale-105 flex items-center space-x-2 shadow-lg mx-auto"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.293a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                                <span>ดาวน์โหลดภาพนี้</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const UserGuide = ({ onGoHome }) => (
    <div className="container mx-auto p-4 animate-fade-in">
        <div className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-6 sm:p-8 rounded-2xl shadow-xl max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl sm:text-3xl font-bold text-cyan-400">คู่มือการใช้งานแอพลิเคชั่น</h2>
                <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                    </svg>
                    <span>หน้าหลัก</span>
                </button>
            </div>
            <div className="space-y-6 text-slate-300 leading-relaxed">
                <div>
                    <h3 className="text-xl font-bold text-cyan-300 mb-2">1. สร้างสรรค์ไอเดีย (Idea Generation)</h3>
                    <p>เครื่องมือนี้ช่วยคุณสร้างไอเดียสำหรับวิดีโอสั้น (Short Video) จำนวน 3 ไอเดียที่ไม่ซ้ำใคร พร้อมรายละเอียดที่สามารถนำไปพัฒนาต่อได้ทันที</p>
                    <ul className="list-disc list-inside mt-2 space-y-1 pl-4 text-slate-400">
                        <li><strong>วิธีใช้:</strong> เลือกหัวข้อ, ระบุกลุ่มเป้าหมาย, และเป้าหมายของคอนเทนต์ แล้วกด "สร้างไอเดีย"</li>
                        <li><strong>ผลลัพธ์:</strong> คุณจะได้ 3 ไอเดียพร้อม Concept, รูปแบบ, เรื่องย่อ, และ Hook</li>
                        <li><strong>ฟีเจอร์เพิ่มเติม:</strong> สามารถสร้างภาพตัวอย่าง (Cover Image) และสคริปต์สำหรับถ่ายทำได้จากแต่ละไอเดีย</li>
                    </ul>
                </div>
                <div>
                    <h3 className="text-xl font-bold text-rose-300 mb-2">2. สร้างสรรค์บทพูด (Speech Generation)</h3>
                    <p>ใช้สำหรับสร้างบทพูดหรือสคริปต์สำหรับงานต่าง ๆ ไม่ว่าจะเป็นการกล่าวเปิดงาน, การนำเสนอ, หรือสคริปต์สำหรับวิดีโอ</p>
                    <ul className="list-disc list-inside mt-2 space-y-1 pl-4 text-slate-400">
                        <li><strong>วิธีใช้:</strong> เลือกประเภท, ระบุหัวข้อ (หรือใช้เสียงพูดเพื่อสร้างไอเดีย), กลุ่มผู้ฟัง, เป้าหมาย, และสไตล์ของผู้พูด</li>
                        <li><strong>ผลลัพธ์:</strong> AI จะสร้างชื่อเรื่องและบทพูดที่สมบูรณ์ให้คุณ</li>
                        <li><strong>ฟีเจอร์เพิ่มเติม:</strong> สามารถนำไอเดียที่บันทึกไว้มาใช้เป็นหัวข้อได้</li>
                    </ul>
                </div>
                <div>
                    <h3 className="text-xl font-bold text-amber-300 mb-2">3. สร้างสรรค์ภาพ (Image Generation)</h3>
                    <p>เปลี่ยนจินตนาการของคุณให้เป็นภาพด้วย AI เพียงแค่ป้อนคำสั่ง (Prompt) ที่ต้องการ</p>
                     <ul className="list-disc list-inside mt-2 space-y-1 pl-4 text-slate-400">
                        <li><strong>วิธีใช้:</strong> พิมพ์คำอธิบายภาพที่ต้องการ, เลือกสไตล์, สัดส่วนภาพ, และจำนวนที่ต้องการสร้าง</li>
                        <li><strong>ผลลัพธ์:</strong> ได้ภาพตามจินตนาการที่สามารถดาวน์โหลดไปใช้งานได้</li>
                    </ul>
                </div>
                 <div>
                    <h3 className="text-xl font-bold text-indigo-300 mb-2">4. ประเมินผลงานสื่อมีเดีย (Media Work Assessment)</h3>
                    <p>ให้ AI ช่วยประเมินผลงานสร้างสรรค์ของคุณ ไม่ว่าจะเป็นสคริปต์, วิดีโอ, หรือภาพถ่าย เพื่อหาจุดแข็งและแนวทางในการพัฒนา</p>
                     <ul className="list-disc list-inside mt-2 space-y-1 pl-4 text-slate-400">
                        <li><strong>วิธีใช้:</strong> เลือกประเภทสื่อ, ระบุเป้าหมาย, และวางเนื้อหาหรืออัปโหลดไฟล์ผลงาน</li>
                        <li><strong>ผลลัพธ์:</strong> AI จะให้คะแนนตามเกณฑ์ต่าง ๆ พร้อมคำแนะนำที่เป็นประโยชน์</li>
                    </ul>
                </div>
                 <div>
                    <h3 className="text-xl font-bold text-emerald-300 mb-2">5. ประเมินผลงานการออกแบบ (Design Assessment)</h3>
                    <p>เครื่องมือสำหรับนักออกแบบที่ต้องการ Feedback เกี่ยวกับผลงาน เช่น UI, โปสเตอร์, หรือชุดภาพกราฟิก</p>
                     <ul className="list-disc list-inside mt-2 space-y-1 pl-4 text-slate-400">
                        <li><strong>วิธีใช้:</strong> อธิบายแนวคิด, กลุ่มเป้าหมาย, เป้าหมาย, และอัปโหลดไฟล์ภาพผลงาน (สามารถอัปได้หลายภาพ)</li>
                        <li><strong>ผลลัพธ์:</strong> ได้รับการประเมินใน 5 ด้านหลักของการออกแบบ พร้อมจุดแข็งและข้อเสนอแนะ</li>
                    </ul>
                </div>
                 <div>
                    <h3 className="text-xl font-bold text-purple-300 mb-2">6. ผู้ช่วยตัดต่อวิดีโอ (Video Editor Assistant)</h3>
                    <p>อัปโหลดคลิปวิดีโอของคุณ แล้วให้ AI ช่วยวางแผนการตัดต่อทั้งหมด ตั้งแต่การลำดับเรื่องไปจนถึงการใส่เสียงและกราฟิก</p>
                     <ul className="list-disc list-inside mt-2 space-y-1 pl-4 text-slate-400">
                        <li><strong>วิธีใช้:</strong> อัปโหลดคลิปวิดีโอ (รองรับหลายไฟล์), ระบุเป้าหมาย, กลุ่มเป้าหมาย, และโทนของวิดีโอ</li>
                        <li><strong>ผลลัพธ์:</strong> AI จะสร้างแผนการตัดต่อแบบละเอียด (Shot List) พร้อมคำแนะนำเรื่องดนตรีและการปรับสี</li>
                    </ul>
                </div>
                 <div className="border-t border-slate-700 pt-4">
                    <h3 className="text-lg font-bold text-slate-300 mb-2">ข้อแนะนำทั่วไป</h3>
                    <p className="text-slate-400">เนื่องจาก API มีโควต้าการใช้งานฟรีที่จำกัด (ประมาณ 1 ครั้งต่อนาที) หากกดปุ่มแล้วไม่มีอะไรเกิดขึ้น หรือขึ้นข้อความแจ้งเตือนโควต้า โปรดรอประมาณ 1 นาทีแล้วลองอีกครั้ง</p>
                </div>
            </div>
        </div>
    </div>
);

const CreatorInfo = ({ onGoHome }) => (
    <div className="container mx-auto p-4 animate-fade-in">
        <div className="bg-slate-900/60 backdrop-blur-lg border border-slate-700/80 p-8 rounded-2xl shadow-xl max-w-2xl mx-auto text-center">
            <div className="flex justify-end mb-4">
                 <button onClick={onGoHome} className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center space-x-2 text-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                    </svg>
                    <span>หน้าหลัก</span>
                </button>
            </div>
            <img 
                src="https://media.licdn.com/dms/image/D5603AQEQ3Y8qS16wAg/profile-displayphoto-shrink_400_400/0/1699504786438?e=1727308800&v=beta&t=k6EAvjQ3R8c8sZp2xY8b8Q6fJ6n8W4y2v7o7i7F0Z7c" 
                alt="Thakorn Yuvijit"
                className="w-32 h-32 rounded-full mx-auto mb-4 border-4 border-cyan-500 shadow-lg"
            />
            <h2 className="text-3xl font-bold text-cyan-400">ฐากร อยู่วิจิตร (Thakorn Yuvijit)</h2>
            <p className="text-slate-400 mt-2">อาจารย์หลักสูตรเทคโนโลยีมัลติมีเดีย สุพรรณบุรี มหาวิทยาลัยเทคโนโลยีราชมงคลสุวรรณภูมิ/AI Developer</p>
            <p className="text-slate-400">นศ.ปริญญาเอก หลักสูตรเทคโนโลยีและนวัตกรรมการเรียนรู้ / มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี</p>
            
            <div className="mt-6 border-t border-slate-700 pt-6">
                <p className="text-slate-300">
                    แอปพลิเคชันนี้ถูกสร้างขึ้นเพื่อเป็นเครื่องมือต้นแบบสำหรับการนำ Generative AI มาประยุกต์ใช้ในงานด้านความคิดสร้างสรรค์ การผลิตสื่อ และการออกแบบการสื่อสาร
                </p>
            </div>
        </div>
    </div>
);


const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState('welcome');
  const [savedIdeas, setSavedIdeas] = useState<Idea[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings>({});
  
  useEffect(() => {
    // On mount, try to load user data, settings, and saved ideas from local storage
    const storedUser = localStorage.getItem('ai-creativity-user');
    const storedSettings = localStorage.getItem('ai-creativity-settings');
    const storedIdeas = localStorage.getItem('ai-creativity-saved-ideas');

    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    if (storedSettings) {
      setUserSettings(JSON.parse(storedSettings));
    }
    if (storedIdeas) {
      setSavedIdeas(JSON.parse(storedIdeas));
    }
  }, []);

  // Persist saved ideas to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('ai-creativity-saved-ideas', JSON.stringify(savedIdeas));
  }, [savedIdeas]);

  // Persist settings to local storage whenever they change
  const updateUserSettings = (newSettings: Partial<UserSettings>) => {
    setUserSettings(prevSettings => {
      const updated = { ...prevSettings, ...newSettings };
      localStorage.setItem('ai-creativity-settings', JSON.stringify(updated));
      return updated;
    });
  };

  const handleLogin = (userData: User) => {
    setUser(userData);
    localStorage.setItem('ai-creativity-user', JSON.stringify(userData));
    // Also save to 'last-user' to pre-fill the form next time
    localStorage.setItem('ai-creativity-last-user', JSON.stringify(userData));
    setPage('welcome');
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('ai-creativity-user');
    setPage('login');
  };

  const renderPage = () => {
    if (!user) return <LoginModule onLogin={handleLogin} />;
    
    switch(page) {
      case 'welcome':
        return <Welcome onNavigate={setPage} />;
      case 'creativeCorner':
        return <CreativeCorner onGoHome={() => setPage('welcome')} savedIdeas={savedIdeas} setSavedIdeas={setSavedIdeas} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings} />;
      case 'speechGeneration':
        return <SpeechGenerationModule onGoHome={() => setPage('welcome')} savedIdeas={savedIdeas} setSavedIdeas={setSavedIdeas} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings} />;
      case 'imageGeneration':
        return <ImageGenerationModule onGoHome={() => setPage('welcome')} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings} />;
      case 'assessment':
        return <AssessmentModule onGoHome={() => setPage('welcome')} user={user} userSettings={userSettings} updateUserSettings={updateUserSettings}/>;
      case 'designAssessment':
        return <DesignAssessmentModule onGoHome={() => setPage('welcome')} user={user} />;
      case 'videoEditorAssistant':
        return <VideoEditorAssistantModule onGoHome={() => setPage('welcome')} user={user} />;
      case 'userGuide':
        return <UserGuide onGoHome={() => setPage('welcome')} />;
      case 'creator':
        return <CreatorInfo onGoHome={() => setPage('welcome')} />;
      default:
        return <Welcome onNavigate={setPage} />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header onGoHome={() => setPage('welcome')} user={user?.user} onLogout={handleLogout} />
      <main className="flex-grow flex items-center justify-center p-4">
        {renderPage()}
      </main>
      <Footer />
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);