import { useContext } from 'react'
import ChatContext from './chat-context'

export default function useChat() {
    const context = useContext(ChatContext)
    if (!context) throw new Error('useChat must be used inside ChatProvider.')
    return context
}