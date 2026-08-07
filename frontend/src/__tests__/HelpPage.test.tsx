import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HelpPage } from '../features/help/HelpPage'

describe('HelpPage', () => {
  it('renders without crashing and contains a top-level heading', () => {
    expect(() => render(<HelpPage />)).not.toThrow()
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0)
  })

  it('contains multiple <img> elements pointing at /guide/tafel-*.png screenshot slots', () => {
    render(<HelpPage />)
    const images = screen.getAllByRole('img') as HTMLImageElement[]
    const guideImages = images.filter((img) => /\/guide\/tafel-.*\.png/i.test(img.getAttribute('src') ?? ''))
    expect(guideImages.length).toBeGreaterThan(1)
  })

  it('documents stabilization behavior without requiring new screenshots', () => {
    render(<HelpPage />)

    expect(screen.getByRole('heading', { name: 'Выполнение и история статуса' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Архив и восстановление' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Профиль и начало недели' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Экспорт данных' })).toBeInTheDocument()
    expect(screen.getByText(/ровно один новый экземпляр/i)).toBeInTheDocument()
    expect(screen.getByText(/часовым поясом профиля Schlüssel/i)).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(6)
  })
})
