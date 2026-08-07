import canvaIconUrl from '@tldraw/assets/embed-icons/canva.png?url'
import codepenIconUrl from '@tldraw/assets/embed-icons/codepen.png?url'
import codesandboxIconUrl from '@tldraw/assets/embed-icons/codesandbox.png?url'
import desmosIconUrl from '@tldraw/assets/embed-icons/desmos.png?url'
import feltIconUrl from '@tldraw/assets/embed-icons/felt.png?url'
import figmaIconUrl from '@tldraw/assets/embed-icons/figma.png?url'
import githubGistIconUrl from '@tldraw/assets/embed-icons/github_gist.png?url'
import googleCalendarIconUrl from '@tldraw/assets/embed-icons/google_calendar.png?url'
import googleMapsIconUrl from '@tldraw/assets/embed-icons/google_maps.png?url'
import googleSlidesIconUrl from '@tldraw/assets/embed-icons/google_slides.png?url'
import observableIconUrl from '@tldraw/assets/embed-icons/observable.png?url'
import replitIconUrl from '@tldraw/assets/embed-icons/replit.png?url'
import scratchIconUrl from '@tldraw/assets/embed-icons/scratch.png?url'
import spotifyIconUrl from '@tldraw/assets/embed-icons/spotify.png?url'
import tldrawIconUrl from '@tldraw/assets/embed-icons/tldraw.png?url'
import valTownIconUrl from '@tldraw/assets/embed-icons/val_town.png?url'
import vimeoIconUrl from '@tldraw/assets/embed-icons/vimeo.png?url'
import youtubeIconUrl from '@tldraw/assets/embed-icons/youtube.png?url'
import monoBoldUrl from '@tldraw/assets/fonts/IBMPlexMono-Bold.woff2?url'
import monoBoldItalicUrl from '@tldraw/assets/fonts/IBMPlexMono-BoldItalic.woff2?url'
import monoMediumUrl from '@tldraw/assets/fonts/IBMPlexMono-Medium.woff2?url'
import monoMediumItalicUrl from '@tldraw/assets/fonts/IBMPlexMono-MediumItalic.woff2?url'
import sansBoldUrl from '@tldraw/assets/fonts/IBMPlexSans-Bold.woff2?url'
import sansBoldItalicUrl from '@tldraw/assets/fonts/IBMPlexSans-BoldItalic.woff2?url'
import sansMediumUrl from '@tldraw/assets/fonts/IBMPlexSans-Medium.woff2?url'
import sansMediumItalicUrl from '@tldraw/assets/fonts/IBMPlexSans-MediumItalic.woff2?url'
import serifBoldUrl from '@tldraw/assets/fonts/IBMPlexSerif-Bold.woff2?url'
import serifBoldItalicUrl from '@tldraw/assets/fonts/IBMPlexSerif-BoldItalic.woff2?url'
import serifMediumUrl from '@tldraw/assets/fonts/IBMPlexSerif-Medium.woff2?url'
import serifMediumItalicUrl from '@tldraw/assets/fonts/IBMPlexSerif-MediumItalic.woff2?url'
import drawBoldUrl from '@tldraw/assets/fonts/Shantell_Sans-Informal_Bold.woff2?url'
import drawBoldItalicUrl from '@tldraw/assets/fonts/Shantell_Sans-Informal_Bold_Italic.woff2?url'
import drawRegularUrl from '@tldraw/assets/fonts/Shantell_Sans-Informal_Regular.woff2?url'
import drawRegularItalicUrl from '@tldraw/assets/fonts/Shantell_Sans-Informal_Regular_Italic.woff2?url'
import iconSpriteUrl from '@tldraw/assets/icons/icon/0_merged.svg?url'
import { iconTypes, type TLUiAssetUrlOverrides } from 'tldraw'

const bundledIcons = Object.fromEntries(
  iconTypes.map((icon) => [icon, `${iconSpriteUrl}#${icon}`]),
)

export const CANVAS_ASSET_URLS = {
  fonts: {
    tldraw_mono_bold: monoBoldUrl,
    tldraw_mono_italic_bold: monoBoldItalicUrl,
    tldraw_mono: monoMediumUrl,
    tldraw_mono_italic: monoMediumItalicUrl,
    tldraw_sans_bold: sansBoldUrl,
    tldraw_sans_italic_bold: sansBoldItalicUrl,
    tldraw_sans: sansMediumUrl,
    tldraw_sans_italic: sansMediumItalicUrl,
    tldraw_serif_bold: serifBoldUrl,
    tldraw_serif_italic_bold: serifBoldItalicUrl,
    tldraw_serif: serifMediumUrl,
    tldraw_serif_italic: serifMediumItalicUrl,
    tldraw_draw_bold: drawBoldUrl,
    tldraw_draw_italic_bold: drawBoldItalicUrl,
    tldraw_draw: drawRegularUrl,
    tldraw_draw_italic: drawRegularItalicUrl,
  },
  icons: bundledIcons,
  translations: {
    en: 'data:application/json,%7B%7D',
    'zh-cn': '/tldraw-translations/zh-cn.json',
  },
  embedIcons: {
    canva: canvaIconUrl,
    codepen: codepenIconUrl,
    codesandbox: codesandboxIconUrl,
    desmos: desmosIconUrl,
    felt: feltIconUrl,
    figma: figmaIconUrl,
    github_gist: githubGistIconUrl,
    google_calendar: googleCalendarIconUrl,
    google_maps: googleMapsIconUrl,
    google_slides: googleSlidesIconUrl,
    observable: observableIconUrl,
    replit: replitIconUrl,
    scratch: scratchIconUrl,
    spotify: spotifyIconUrl,
    tldraw: tldrawIconUrl,
    val_town: valTownIconUrl,
    vimeo: vimeoIconUrl,
    youtube: youtubeIconUrl,
  },
} satisfies TLUiAssetUrlOverrides
