
import fs from 'fs';
import { isString } from './utils.js';
import { env } from './env.js';

import { getFile } from './utils/hub.js';

// Will be empty (or not used) if running in browser or web-worker
import sharp from 'sharp';

const BROWSER_ENV = typeof self !== 'undefined';

let createCanvasFunction;
let ImageDataClass;
let loadImageFunction;
if (BROWSER_ENV) {
    // Running in browser or web-worker
    createCanvasFunction = (/** @type {number} */ width, /** @type {number} */ height) => {
        if (!self.OffscreenCanvas) {
            throw new Error('OffscreenCanvas not supported by this browser.');
        }
        return new self.OffscreenCanvas(width, height)
    };
    loadImageFunction = self.createImageBitmap;
    ImageDataClass = self.ImageData;

} else if (sharp) {
    // Running in Node.js, electron, or other non-browser environment

    loadImageFunction = async (/**@type {sharp.Sharp}*/img) => {
        let { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        return new CustomImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
    }

} else {
    throw new Error('Unable to load image processing library.');
}


export class CustomImage {

    /**
     * Create a new CustomImage object.
     * @param {Uint8ClampedArray} data - The pixel data.
     * @param {number} width - The width of the image.
     * @param {number} height - The height of the image.
     * @param {1|2|3|4} channels - The number of channels.
     */
    constructor(data, width, height, channels) {
        this._update(data, width, height, channels);
    }

    /**
     * Helper method for reading an image from a variety of input types.
     * @param {CustomImage|string|URL} input 
     * @returns The image object.
     */
    static async read(input) {
        if (input instanceof CustomImage) {
            return input;
        } else if (isString(input) || input instanceof URL) {
            return await this.fromURL(input);
        } else {
            throw new Error(`Unsupported input type: ${typeof input}`);
        }
    }


    /**
     * Read an image from a URL or file path.
     * @param {string|URL} url - The URL or file path to read the image from.
     * @returns {Promise<CustomImage>} - The image object.
     */
    static async fromURL(url) {
        let response = await getFile(url);
        let blob = await response.blob();
        return this.fromBlob(blob);
    }

    /**
     * Helper method to create a new Image from a blob.
     * @param {Blob} blob - The blob to read the image from.
     * @returns {Promise<CustomImage>} - The image object.
     */
    static async fromBlob(blob) {
        if (BROWSER_ENV) {
            // Running in environment with canvas
            let img = await loadImageFunction(blob);

            const ctx = createCanvasFunction(img.width, img.height).getContext('2d');

            // Draw image to context
            ctx.drawImage(img, 0, 0);

            return new this(ctx.getImageData(0, 0, img.width, img.height).data, img.width, img.height, 4);

        } else {
            // Use sharp.js to read (and possible resize) the image.
            let img = sharp(await blob.arrayBuffer());

            return await loadImageFunction(img);
        }
    }

    /**
     * Convert the image to grayscale format.
     * @returns {CustomImage} - `this` to support chaining.
     */
    grayscale() {
        if (this.channels === 1) {
            return this;
        }

        let newData = new Uint8ClampedArray(this.width * this.height * 3);
        switch (this.channels) {
            case 3: // rgb to grayscale
            case 4: // rgba to grayscale
                for (let i = 0, offset = 0; i < this.data.length; i += this.channels) {
                    const red = this.data[i];
                    const green = this.data[i + 1];
                    const blue = this.data[i + 2];

                    newData[offset++] = Math.round(0.2989 * red + 0.5870 * green + 0.1140 * blue);
                }
                break;
            default:
                throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }
        return this._update(newData, this.width, this.height, 1);
    }

    /**
     * Convert the image to RGB format.
     * @returns {CustomImage} - `this` to support chaining.
     */
    rgb() {
        if (this.channels === 3) {
            return this;
        }

        let newData = new Uint8ClampedArray(this.width * this.height * 3);

        switch (this.channels) {
            case 1: // grayscale to rgb
                for (let i = 0, offset = 0; i < this.data.length; ++i) {
                    newData[offset++] = this.data[i];
                    newData[offset++] = this.data[i];
                    newData[offset++] = this.data[i];
                }
                break;
            case 4: // rgba to rgb
                for (let i = 0, offset = 0; i < this.data.length; i += 4) {
                    newData[offset++] = this.data[i];
                    newData[offset++] = this.data[i + 1];
                    newData[offset++] = this.data[i + 2];
                }
                break;
            default:
                throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }
        return this._update(newData, this.width, this.height, 3);

    }

    /**
     * Convert the image to RGBA format.
     * @returns {CustomImage} - `this` to support chaining.
     */
    rgba() {
        if (this.channels === 4) {
            return this;
        }

        let newData = new Uint8ClampedArray(this.width * this.height * 4);

        switch (this.channels) {
            case 1: // grayscale to rgba
                for (let i = 0, offset = 0; i < this.data.length; ++i) {
                    newData[offset++] = this.data[i];
                    newData[offset++] = this.data[i];
                    newData[offset++] = this.data[i];
                    newData[offset++] = 255;
                }
                break;
            case 3: // rgb to rgba
                for (let i = 0, offset = 0; i < this.data.length; i += 3) {
                    newData[offset++] = this.data[i];
                    newData[offset++] = this.data[i + 1];
                    newData[offset++] = this.data[i + 2];
                    newData[offset++] = 255;
                }
                break;
            default:
                throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }

        return this._update(newData, this.width, this.height, 4);
    }

    /**
     * Resize the image to the given dimensions. This method uses the canvas API to perform the resizing.
     * @param {number} width - The width of the new image.
     * @param {number} height - The height of the new image.
     * @param {object} options - Additional options for resizing.
     * @param {string} [options.resample] - The resampling method to use. Can be one of `nearest`, `bilinear`, `bicubic`.
     * @returns {Promise<CustomImage>} - `this` to support chaining.
     */
    async resize(width, height, {
        // TODO: Use `resample`
        resample = 'bilinear',
    } = {}) {
        if (BROWSER_ENV) {
            // Store number of channels before resizing
            let numChannels = this.channels;

            // Create canvas object for this image
            let canvas = this.toCanvas();

            // Actually perform resizing using the canvas API
            const ctx = createCanvasFunction(width, height).getContext('2d');

            // Draw image to context, resizing in the process
            ctx.drawImage(canvas, 0, 0, width, height);

            // Create image from the resized data
            let resizedImage = new CustomImage(ctx.getImageData(0, 0, width, height).data, width, height, 4);

            // Convert back so that image has the same number of channels as before
            return resizedImage.convert(numChannels);

        } else {
            // Create sharp image from raw data, and resize
            let img = sharp(this.data, {
                raw: {
                    width: this.width,
                    height: this.height,
                    channels: this.channels
                }
            }).resize({
                // https://github.com/lovell/sharp/blob/main/docs/api-resize.md
                width, height,
                fit: 'fill',
                kernel: 'cubic'
            });
            return await loadImageFunction(img);
        }

    }

    async center_crop(crop_width, crop_height) {
        // If the image is already the desired size, return it
        if (this.width === crop_width && this.height === crop_height) {
            return this;
        }

        // Determine bounds of the image in the new canvas
        let width_offset = (this.width - crop_width) / 2;
        let height_offset = (this.height - crop_height) / 2;


        if (BROWSER_ENV) {
            // Store number of channels before resizing
            let numChannels = this.channels;

            // Create canvas object for this image
            let canvas = this.toCanvas();

            // Create a new canvas of the desired size. This is needed since if the 
            // image is too small, we need to pad it with black pixels.
            const ctx = createCanvasFunction(crop_width, crop_height).getContext('2d');

            let sourceX = 0;
            let sourceY = 0;
            let destX = 0;
            let destY = 0;

            if (width_offset >= 0) {
                sourceX = width_offset;
            } else {
                destX = -width_offset;
            }

            if (height_offset >= 0) {
                sourceY = height_offset;
            } else {
                destY = -height_offset;
            }

            // Draw image to context, cropping in the process
            ctx.drawImage(canvas,
                sourceX, sourceY, crop_width, crop_height,
                destX, destY, crop_width, crop_height
            );

            // Create image from the resized data
            let resizedImage = new CustomImage(ctx.getImageData(0, 0, crop_width, crop_height).data, crop_width, crop_height, 4);

            // Convert back so that image has the same number of channels as before
            return resizedImage.convert(numChannels);

        } else {
            // Create sharp image from raw data
            let img = sharp(this.data, {
                raw: {
                    width: this.width,
                    height: this.height,
                    channels: this.channels
                }
            });

            if (width_offset >= 0 && height_offset >= 0) {
                // Cropped image lies entirely within the original image
                img = img.extract({
                    left: Math.floor(width_offset),
                    top: Math.floor(height_offset),
                    width: crop_width,
                    height: crop_height,
                })
            } else if (width_offset <= 0 && height_offset <= 0) {
                // Cropped image lies entirely outside the original image,
                // so we add padding
                let top = Math.floor(-height_offset);
                let left = Math.floor(-width_offset);
                img = img.extend({
                    top: top,
                    left: left,

                    // Ensures the resulting image has the desired dimensions
                    right: crop_width - this.width - left,
                    bottom: crop_height - this.height - top,
                });
            } else {
                // Cropped image lies partially outside the original image.
                // We first pad, then crop.

                let y_padding = [0, 0];
                let y_extract = 0;
                if (height_offset < 0) {
                    y_padding[0] = Math.floor(-height_offset);
                    y_padding[1] = crop_height - this.height - y_padding[0];
                } else {
                    y_extract = Math.floor(height_offset);
                }

                let x_padding = [0, 0];
                let x_extract = 0;
                if (width_offset < 0) {
                    x_padding[0] = Math.floor(-width_offset);
                    x_padding[1] = crop_width - this.width - x_padding[0];
                } else {
                    x_extract = Math.floor(width_offset);
                }

                img = img.extend({
                    top: y_padding[0],
                    bottom: y_padding[1],
                    left: x_padding[0],
                    right: x_padding[1],
                }).extract({
                    left: x_extract,
                    top: y_extract,
                    width: crop_width,
                    height: crop_height,
                })
            }

            return await loadImageFunction(img);
        }
    }

    toCanvas() {
        // Clone, and convert data to RGBA before drawing to canvas.
        // This is because the canvas API only supports RGBA
        let cloned = this.clone().rgba();

        // Create canvas object for the cloned image
        let clonedCanvas = createCanvasFunction(cloned.width, cloned.height);

        // Draw image to context
        let data = new ImageDataClass(cloned.data, cloned.width, cloned.height);
        clonedCanvas.getContext('2d').putImageData(data, 0, 0);

        return clonedCanvas;
    }

    /**
     * Helper method to update the image data.
     * @param {Uint8ClampedArray} data - The new image data.
     * @param {number} width - The new width of the image.
     * @param {number} height - The new height of the image.
     * @param {1|2|3|4} channels - The new number of channels of the image.
     */
    _update(data, width, height, channels = null) {
        this.data = data;
        this.width = width;
        this.height = height;
        if (channels !== null) {
            this.channels = channels;
        }
        return this;
    }

    /**
     * Clone the image
     * @returns {CustomImage} - The cloned image
     */
    clone() {
        return new CustomImage(this.data.slice(), this.width, this.height, this.channels);
    }

    /**
     * Helper method for converting image to have a certain number of channels
     * @param {number} numChannels - The number of channels. Must be 1, 3, or 4.
     * @returns {CustomImage} - `this` to support chaining.
     */
    convert(numChannels) {
        if (this.channels === numChannels) return this; // Already correct number of channels

        switch (numChannels) {
            case 1:
                this.grayscale();
                break;
            case 3:
                this.rgb();
                break;
            case 4:
                this.rgba();
                break;
            default:
                throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }
        return this;
    }

    /**
     * Save the image to the given path. This method is only available in environments with access to the FileSystem.
     * @param {string|Buffer|URL} path - The path to save the image to.
     * @param {string} [mime='image/png'] - The mime type of the image.
     */
    save(path, mime = 'image/png') {
        if (!env.useFS) {
            throw new Error('Unable to save the image because filesystem is disabled in this environment.')
        }

        let canvas = this.toCanvas();
        const buffer = canvas.toBuffer(mime);
        fs.writeFileSync(path, buffer);
    }
}
