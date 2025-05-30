import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
        <h1 className="text-3xl font-bold text-gray-800 text-center mb-6">
          Figma Flow Capture
        </h1>
        <div className="space-y-4">
          <p className="text-gray-600 text-center">
            Testing Tailwind CSS Integration
          </p>
          <div className="flex items-center justify-center space-x-4">
            <button 
              onClick={() => setCount(count - 1)}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              -
            </button>
            <span className="text-2xl font-bold text-gray-800 min-w-[3rem] text-center">
              {count}
            </span>
            <button 
              onClick={() => setCount(count + 1)}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              +
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="bg-blue-100 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-800">Blue Card</h3>
              <p className="text-blue-600 text-sm">Testing colors</p>
            </div>
            <div className="bg-green-100 p-4 rounded-lg">
              <h3 className="font-semibold text-green-800">Green Card</h3>
              <p className="text-green-600 text-sm">Testing layout</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
