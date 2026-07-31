import { useState } from 'react'

interface ToastState {
  variant: 'success' | 'error'
  message: string
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  return {
    toast,
    showSuccess: (message: string) => setToast({ variant: 'success', message }),
    showError: (message: string) => setToast({ variant: 'error', message }),
    dismiss: () => setToast(null),
  }
}
