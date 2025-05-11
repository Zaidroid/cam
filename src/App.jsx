import React from 'react';
import LocalVideoView from './components/ChatView/LocalVideoView';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>ArabConnect Video Chat</h1>
      </header>
      <main>
        <LocalVideoView />
      </main>
    </div>
  );
}

export default App;
