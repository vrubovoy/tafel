import { Footer as SharedFooter } from '@zudar107/schloss-ui'

export function Footer() {
  return <SharedFooter serviceName="Tafel" description="Личные проекты и задачи" version={__APP_VERSION__} helpHref="/help" />
}
