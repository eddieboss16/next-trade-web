import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../App'
import { AppProviders } from '../AppProviders'

/** The instruments payload the API returns, in its real snake_case shape. */
export const API_INSTRUMENTS = [
  { id: 'AAPL', symbol: 'AAPL', price_scale: 2, quantity_scale: 0 },
]

/** Mounts the real app at a path, with the real provider stack. */
export function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  )
}
