import { imageMimeTypes, maxImageBytes, maxImages } from '../shared/protocol.ts'
import { HttpError } from './http-error.ts'

export function promptImages(value: unknown) {
  const images = value === undefined ? [] : value
  if (!Array.isArray(images)) throw new HttpError(400, 'Expected images array')
  if (images.length > maxImages) throw new HttpError(413, `At most ${maxImages} images`)
  return images.map((image: unknown) => {
    if (!image || typeof image !== 'object') throw new HttpError(400, 'Invalid image')
    const { data, mimeType } = image as Record<string, unknown>
    if (
      typeof mimeType !== 'string' ||
      !imageMimeTypes.includes(mimeType) ||
      typeof data !== 'string' ||
      !data ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      throw new HttpError(400, 'Expected supported image MIME type and base64 data')
    if (Buffer.byteLength(data, 'base64') > maxImageBytes)
      throw new HttpError(413, 'Image exceeds 2 MiB')
    if (Buffer.from(data, 'base64').toString('base64') !== data)
      throw new HttpError(400, 'Invalid image base64 data')
    return { type: 'image' as const, data, mimeType }
  })
}
