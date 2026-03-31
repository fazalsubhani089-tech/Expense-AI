import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ParsedExpense {
  amount: number;
  category: string;
  description: string;
  date: string; // ISO string
}

export async function parseExpensePrompt(prompt: string, currentDate: string): Promise<ParsedExpense[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Current date is ${currentDate}. Parse the following text (which might be in Roman Urdu, English, or a mix) and extract ALL individual expense records mentioned. 
    There is NO limit on the number of records you can extract. Process every single item mentioned in the text.
    
    For each expense, identify:
    - amount (number, extract the numeric value. If it says '1500', use 1500. If it says '1.5k', use 1500.)
    - category (string, e.g., Construction, Material, Labor, Food, Fuel, etc. Be specific.)
    - description (string, what was it for? e.g., 'Cement 46 bags', 'Nazeer Thekedar advance'. Keep it detailed.)
    - date (ISO string. If a specific date is mentioned, use it. If no date is mentioned, use the current date).
    
    The text might describe a long list of items from a project. Extract each item as a separate, unique expense entry.
    
    Prompt: "${prompt}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            amount: { type: Type.NUMBER },
            category: { type: Type.STRING },
            description: { type: Type.STRING },
            date: { type: Type.STRING, format: "date-time" }
          },
          required: ["amount", "category", "date"]
        }
      }
    }
  });

  try {
    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as ParsedExpense[];
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    return [];
  }
}
