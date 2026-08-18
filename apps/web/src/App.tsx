import { ChatBox } from './components/ChatBox';
import { FetchChatApi, resolveApiBaseUrl } from './services/chat-api';
import styles from './App.module.css';

const chatApi = new FetchChatApi(resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL));

export function App() {
  return (
    <main className={styles.page}>
      <ChatBox chatApi={chatApi} />
    </main>
  );
}
