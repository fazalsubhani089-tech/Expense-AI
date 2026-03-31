import { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { 
  Plus, 
  Trash2, 
  LogOut, 
  LogIn, 
  Calendar as CalendarIcon, 
  TrendingUp, 
  TrendingDown,
  Search,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from './firebase';
import { parseExpensePrompt } from './services/geminiService';
import { Expense, OperationType, FirestoreErrorInfo } from './types';
import { cn } from './lib/utils';

const googleProvider = new GoogleAuthProvider();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Date range filters - Defaulting to a wider range to show historical data
  const [startDate, setStartDate] = useState<string>(format(new Date(2024, 0, 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore connection test
  useEffect(() => {
    if (isAuthReady && user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady, user]);

  // Real-time expenses listener
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const q = query(
      collection(db, 'expenses'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const expenseList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Expense[];
      
      // Sort client-side to avoid composite index requirement
      const sortedExpenses = [...expenseList].sort((a, b) => 
        b.date.toMillis() - a.date.toMillis()
      );
      
      setExpenses(sortedExpenses);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'expenses');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error:', JSON.stringify(errInfo));
    // Show a more descriptive error message if it's a known issue like missing index
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('index')) {
      setError("Database optimization in progress. Please try again in a moment.");
    } else if (message.includes('permission')) {
      setError("You don't have permission to perform this action.");
    } else {
      setError("Something went wrong with the database. Please try again.");
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login failed:", err);
      setError("Failed to sign in with Google.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const handleSubmitPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !user) return;

    setIsParsing(true);
    setError(null);
    
    try {
      const results = await parseExpensePrompt(prompt, new Date().toISOString());
      
      if (results && results.length > 0) {
        // Add all expenses to Firestore
        for (const result of results) {
          let expenseDate: Date;
          try {
            expenseDate = new Date(result.date);
            if (isNaN(expenseDate.getTime())) throw new Error("Invalid date");
          } catch (e) {
            expenseDate = new Date(); // Fallback to current date
          }

          await addDoc(collection(db, 'expenses'), {
            amount: result.amount,
            category: result.category,
            description: result.description || '',
            date: Timestamp.fromDate(expenseDate),
            uid: user.uid
          });
        }
        setPrompt('');
      } else {
        setError("I couldn't understand those expenses. Try something like 'Spent 500 on lunch today'.");
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses');
    } finally {
      setIsParsing(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `expenses/${id}`);
    }
  };

  const filteredExpenses = expenses.filter(expense => {
    const expenseDate = expense.date.toDate();
    const dateMatch = isWithinInterval(expenseDate, {
      start: parseISO(startDate),
      end: parseISO(endDate)
    });
    const categoryMatch = selectedCategories.length === 0 || selectedCategories.includes(expense.category);
    return dateMatch && categoryMatch;
  });

  const allCategories = Array.from(new Set(expenses.map(e => e.category))).sort();

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category) 
        : [...prev, category]
    );
  };

  const totalExpense = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <div className="animate-pulse text-[#5A5A40] font-serif text-xl italic">Loading your vault...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-xl shadow-black/5 text-center"
        >
          <div className="w-20 h-20 bg-[#5A5A40] rounded-full flex items-center justify-center mx-auto mb-8">
            <TrendingUp className="text-white w-10 h-10" />
          </div>
          <h1 className="font-serif text-4xl text-[#1A1A1A] mb-4">Expense AI</h1>
          <p className="text-[#5A5A40] mb-10 leading-relaxed italic">
            "Track your spending with the ease of a conversation."
          </p>
          <button 
            onClick={handleLogin}
            className="w-full bg-[#5A5A40] text-white rounded-full py-4 font-medium flex items-center justify-center gap-3 hover:bg-[#4A4A30] transition-colors"
          >
            <LogIn size={20} />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A1A] font-sans pb-32">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-black/5">
        <div className="max-w-5xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-full flex items-center justify-center">
              <TrendingUp className="text-white w-6 h-6" />
            </div>
            <h1 className="font-serif text-2xl font-bold tracking-tight">Expense AI</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-right">
              <p className="text-xs font-medium text-[#5A5A40] uppercase tracking-wider">Logged in as</p>
              <p className="text-sm font-semibold">{user.displayName}</p>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-black/5 rounded-full transition-colors text-[#5A5A40]"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-10">
        {/* Summary Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="md:col-span-2 bg-white rounded-[32px] p-8 shadow-xl shadow-black/5 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] opacity-60">Total Spending</span>
                <button 
                  onClick={() => setShowFilters(!showFilters)}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    showFilters ? "bg-[#5A5A40] text-white" : "bg-black/5 text-[#5A5A40]"
                  )}
                >
                  <Filter size={16} />
                </button>
              </div>
              <h2 className="text-6xl font-serif font-light mb-2">
                Rs. {totalExpense.toLocaleString()}
              </h2>
              <p className="text-[#5A5A40] italic">
                {format(parseISO(startDate), 'MMM d')} — {format(parseISO(endDate), 'MMM d, yyyy')}
              </p>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mt-6 pt-6 border-t border-black/5"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#5A5A40] mb-1">From</label>
                        <input 
                          type="date" 
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full bg-black/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#5A5A40] mb-1">To</label>
                        <input 
                          type="date" 
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full bg-black/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-bold text-[#5A5A40] mb-2">Categories</label>
                      <div className="flex flex-wrap gap-2">
                        {allCategories.length === 0 ? (
                          <p className="text-xs italic text-[#5A5A40] opacity-50">No categories found yet.</p>
                        ) : (
                          allCategories.map(cat => (
                            <button
                              key={cat}
                              onClick={() => toggleCategory(cat)}
                              className={cn(
                                "px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all border",
                                selectedCategories.includes(cat)
                                  ? "bg-[#5A5A40] text-white border-[#5A5A40]"
                                  : "bg-transparent text-[#5A5A40] border-[#5A5A40]/20 hover:border-[#5A5A40]/50"
                              )}
                            >
                              {cat}
                            </button>
                          ))
                        )}
                        {selectedCategories.length > 0 && (
                          <button
                            onClick={() => setSelectedCategories([])}
                            className="px-3 py-1 rounded-full text-[10px] font-bold uppercase text-red-500 hover:bg-red-50 transition-all"
                          >
                            Clear All
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <div className="bg-[#5A5A40] rounded-[32px] p-8 text-white flex flex-col justify-center items-center text-center">
            <TrendingDown className="w-12 h-12 mb-4 opacity-50" />
            <h3 className="font-serif text-2xl mb-2">Smart Insights</h3>
            <p className="text-white/70 text-sm italic">
              "You've recorded {filteredExpenses.length} transactions in this period."
            </p>
          </div>
        </div>

        {/* Expense List */}
        <div className="bg-white rounded-[32px] shadow-xl shadow-black/5 overflow-hidden">
          <div className="px-8 py-6 border-b border-black/5 flex items-center justify-between">
            <h3 className="font-serif text-xl">Transaction History</h3>
            <span className="text-xs font-bold text-[#5A5A40] bg-black/5 px-3 py-1 rounded-full">
              {filteredExpenses.length} Items
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/5">
                  <th className="px-8 py-4 text-[10px] uppercase font-bold text-[#5A5A40] tracking-widest">Date</th>
                  <th className="px-8 py-4 text-[10px] uppercase font-bold text-[#5A5A40] tracking-widest">Category</th>
                  <th className="px-8 py-4 text-[10px] uppercase font-bold text-[#5A5A40] tracking-widest">Description</th>
                  <th className="px-8 py-4 text-[10px] uppercase font-bold text-[#5A5A40] tracking-widest text-right">Amount</th>
                  <th className="px-8 py-4 w-10"></th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-8 py-20 text-center text-[#5A5A40] italic opacity-50">
                        No transactions found for this period.
                      </td>
                    </tr>
                  ) : (
                    filteredExpenses.map((expense) => (
                      <motion.tr 
                        key={expense.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="group hover:bg-[#F5F5F0]/50 transition-colors border-b border-black/5 last:border-0"
                      >
                        <td className="px-8 py-4 text-sm font-medium">
                          {format(expense.date.toDate(), 'MMM d, yyyy')}
                        </td>
                        <td className="px-8 py-4">
                          <span className="text-[10px] uppercase font-bold bg-[#5A5A40]/10 text-[#5A5A40] px-2 py-1 rounded-md">
                            {expense.category}
                          </span>
                        </td>
                        <td className="px-8 py-4 text-sm text-[#5A5A40]">
                          {expense.description || '-'}
                        </td>
                        <td className="px-8 py-4 text-sm font-bold text-right">
                          Rs. {expense.amount.toLocaleString()}
                        </td>
                        <td className="px-8 py-4 text-right">
                          <button 
                            onClick={() => handleDeleteExpense(expense.id)}
                            className="p-2 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded-full transition-all"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Chat Input Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F5F5F0] via-[#F5F5F0] to-transparent">
        <div className="max-w-3xl mx-auto">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl flex items-center justify-between"
            >
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
            </motion.div>
          )}

          <form 
            onSubmit={handleSubmitPrompt}
            className="relative group"
          >
            <div className="absolute left-6 top-1/2 -translate-y-1/2 text-[#5A5A40] opacity-50 group-focus-within:opacity-100 transition-opacity">
              <MessageSquare size={20} />
            </div>
            <input 
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Tell me what you spent... (e.g., '1500 for grocery today')"
              disabled={isParsing}
              className="w-full bg-white rounded-full py-6 pl-16 pr-20 shadow-2xl shadow-black/10 focus:outline-none focus:ring-4 focus:ring-[#5A5A40]/10 transition-all disabled:opacity-50"
            />
            <button 
              type="submit"
              disabled={isParsing || !prompt.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#5A5A40] text-white p-4 rounded-full disabled:opacity-50 hover:bg-[#4A4A30] transition-colors shadow-lg"
            >
              {isParsing ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Plus size={20} />
              )}
            </button>
          </form>
          <p className="text-center text-[10px] uppercase font-bold text-[#5A5A40] mt-4 tracking-[0.2em] opacity-40">
            Powered by Gemini AI
          </p>
        </div>
      </div>
    </div>
  );
}
