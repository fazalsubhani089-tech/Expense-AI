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
    contents: `Current date is ${currentDate}. Parse the following text (which might be in Roman Urdu or English) and extract ALL individual expense records mentioned. 
    For each expense, identify:
    - amount (number, extract the numeric value)
    - category (string, e.g., Construction, Material, Labor, Food, Fuel, etc.)
    - description (string, what was it for? e.g., 'Cement 46 bags', 'Nazeer Thekedar advance')
    - date (ISO string. If a specific date is mentioned like '30 July 2024', use that. If a range is mentioned like '30 July to 27 August', use the start date for the record or split if possible. If no date is mentioned, use the current date).
    
    The text describes a construction project with many items. Extract each item as a separate expense. For example, if it says 'Cement 81,550 PKR', create an entry for that. If it says 'Petrol 700 PKR', create an entry for that.
    
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
