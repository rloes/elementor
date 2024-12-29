import { readFile } from 'fs/promises';
import { addElement, getElementSelector } from '../assets/elements-utils';
import { expect, type Page, type Frame, type TestInfo, type ElementHandle, Locator } from '@playwright/test';
import BasePage from './base-page';
import EditorSelectors from '../selectors/editor-selectors';
import _path, { resolve as pathResolve } from 'path';
import { getComparator } from 'playwright-core/lib/utils';
import AxeBuilder from '@axe-core/playwright';
import { $eType, Device, WindowType, BackboneType, ElementorType } from '../types/types';
import TopBarSelectors, { TopBarSelector } from '../selectors/top-bar-selectors';
import Breakpoints from '../assets/breakpoints';
let $e: $eType;
let elementor: ElementorType;
let Backbone: BackboneType;
let window: WindowType;

export default class EditorPage extends BasePage {
	readonly previewFrame: Frame;
	postId: number | null;

	/**
	 * Create an Elementor editor page.
	 *
	 * @param {Page}     page        - Playwright page instance.
	 * @param {TestInfo} testInfo    - Test information.
	 * @param {number}   cleanPostId - Optional. Post ID.
	 *
	 * @return {void}
	 */
	constructor( page: Page, testInfo: TestInfo, cleanPostId: null | number = null ) {
		super( page, testInfo );
		this.previewFrame = this.getPreviewFrame();
		this.postId = cleanPostId;
	}

	/**
	 * Open a specific post in the elementor editor.
	 *
	 * @param {number|string} id - Optional. Post ID. Default is the ID of the current post.
	 *
	 * @return {Promise<void>}
	 */
	async gotoPostId( id: number|string = this.postId ): Promise<void> {
		await this.page.goto( `wp-admin/post.php?post=${ id }&action=elementor` );
		await this.page.waitForLoadState( 'load' );
		await this.waitForPanelToLoad();
	}

	/**
	 * Update image dates in the template data.
	 *
	 * @param {JSON} templateData - Template data.
	 *
	 * @return {JSON}
	 */
	updateImageDates( templateData: JSON ): JSON {
		const date = new Date();
		const month = date.toLocaleString( 'default', { month: '2-digit' } );
		const data = JSON.stringify( templateData );
		const updatedData = data.replace( /[0-9]{4}\/[0-9]{2}/g, `${ date.getFullYear() }/${ month }` );
		return JSON.parse( updatedData ) as JSON;
	}

	/**
	 * Upload SVG in the Media Library. Expects media library to be open.
	 *
	 * @param {string} svgFileName - Optional. SVG file name, without extension.
	 *
	 * @return {Promise<void>}
	 */
	async uploadSVG( svgFileName?: string ): Promise<void> {
		const _svgFileName = svgFileName === undefined ? 'test-svg-wide' : svgFileName;
		const regex = new RegExp( _svgFileName );
		const response = this.page.waitForResponse( regex );
		await this.page.setInputFiles( EditorSelectors.media.imageInp, _path.resolve( __dirname, `../resources/${ _svgFileName }.svg` ) );
		await response;
		await this.page.getByRole( 'button', { name: 'Insert Media' } )
			.or( this.page.getByRole( 'button', { name: 'Select' } ) ).nth( 1 ).click();
	}

	/**
	 * Load a template from a file.
	 *
	 * @param {string}  filePath             - Path to the template file.
	 * @param {boolean} updateDatesForImages - Optional. Whether to update images dates. Default is false.
	 */
	async loadTemplate( filePath: string, updateDatesForImages: boolean = false ): Promise<void> {
		const rawFileData = await readFile( filePath );
		let templateData = JSON.parse( rawFileData.toString() );

		// For templates that use images, date when image is uploaded is hardcoded in template.
		// Element regression tests upload images before each test.
		// To update dates in template, use a flag updateDatesForImages = true
		if ( updateDatesForImages ) {
			templateData = this.updateImageDates( templateData );
		}

		await this.page.evaluate( ( data ) => {
			const model = new Backbone.Model( { title: 'test' } );

			window.$e.run( 'document/elements/import', {
				data,
				model,
				options: {
					at: 0,
					withPageSettings: false,
				},
			} );
		}, templateData );
	}

	/**
	 * Remove all the content from the page.
	 *
	 * @return {Promise<void>}
	 */
	async cleanContent(): Promise<void> {
		await this.page.evaluate( () => {
			$e.run( 'document/elements/empty', { force: true } );
		} );
	}

	/**
	 * Wait for the editor panels to finish loading.
	 *
	 * @return {Promise<void>}
	 */
	async waitForPanelToLoad(): Promise<void> {
		await this.page.waitForSelector( '.elementor-panel-loading', { state: 'detached' } );
		await this.page.waitForSelector( '#elementor-loading', { state: 'hidden' } );
	}

	/**
	 * Add element to the page using a model.
	 *
	 * @param {Object}  model               - Model definition.
	 * @param {string}  container           - Optional. Container to create the element in.
	 * @param {boolean} isContainerASection - Optional. Whether the container is a section.
	 *
	 * @return {Promise<string>} Element ID
	 */
	async addElement( model: unknown, container: null | string = null, isContainerASection = false ): Promise<string> {
		return await this.page.evaluate( addElement, { model, container, isContainerASection } );
	}

	/**
	 * Remove element from the page.
	 *
	 * @param {string} elementId - Element ID.
	 *
	 * @return {Promise<void>}
	 */
	async removeElement( elementId: string ): Promise<void> {
		await this.page.evaluate( ( { id } ) => {
			$e.run( 'document/elements/delete', {
				container: elementor.getContainer( id ),
			} );
		}, { id: elementId } );
	}

	/**
	 * Add a widget by `widgetType`.
	 *
	 * @param {string}  widgetType          - Widget type.
	 * @param {string}  container           - Optional. Container to create the element in.
	 * @param {boolean} isContainerASection - Optional. Whether the container is a section.
	 *
	 * @return {Promise<string>} The widget ID.
	 */
	async addWidget( widgetType: string, container = null, isContainerASection = false ): Promise<string> {
		const widgetId = await this.addElement( { widgetType, elType: 'widget' }, container, isContainerASection );
		await this.getPreviewFrame().waitForSelector( `[data-id='${ widgetId }']` );

		return widgetId;
	}

	/**
	 * Add a page by importing a Json page object from PostMeta _elementor_data into Tests
	 *
	 * @param {string}  dirName              - Directory name, use `__dirname` for the current directory.
	 * @param {string}  fileName             - Name of the file without extension.
	 * @param {string}  widgetSelector       - Selector of the widget.
	 * @param {boolean} updateDatesForImages - Optional. Whether to update image dates in the template. Default is false.
	 *
	 * @return {Promise<void>}
	 */
	async loadJsonPageTemplate( dirName: string, fileName: string, widgetSelector: string, updateDatesForImages: boolean = false ): Promise<void> {
		const filePath = _path.resolve( dirName, `./templates/${ fileName }.json` );
		const rawFileData = await readFile( filePath );
		const templateData = JSON.parse( rawFileData.toString() );
		const pageTemplateData =
		{
			content: templateData,
			page_settings: [],
			version: '0.4',
			title: 'Elementor Test',
			type: 'page',
		};

		// For templates that use images, date when image is uploaded is hardcoded in template.
		// Element regression tests upload images before each test.
		// To update dates in template, use a flag updateDatesForImages = true
		if ( updateDatesForImages ) {
			this.updateImageDates( templateData );
		}

		await this.page.evaluate( ( data ) => {
			const model = new Backbone.Model( { title: 'test' } );

			window.$e.run( 'document/elements/import', {
				data,
				model,
				options: {
					at: 0,
					withPageSettings: false,
				},
			} );
		}, pageTemplateData );

		await this.waitForElement( false, widgetSelector );
	}

	/**
	 * Get element handle from the preview frame using its Container ID.
	 *
	 * @param {string} id - Container ID.
	 *
	 * @return {Promise<ElementHandle<SVGElement | HTMLElement> | null>} element handle
	 */
	async getElementHandle( id: string ): Promise<ElementHandle<SVGElement | HTMLElement> | null> {
		return this.getPreviewFrame().$( getElementSelector( id ) );
	}

	/**
	 * Get the frame of the Elementor editor preview.
	 *
	 * @return {Frame}
	 */
	getPreviewFrame(): Frame {
		return this.page.frame( { name: 'elementor-preview-iframe' } );
	}

	/**
	 * Select an element inside the editor.
	 *
	 * @param {string} elementId - Element ID.
	 *
	 * @return {Promise<Locator>} element;
	 */
	async selectElement( elementId: string ): Promise<Locator> {
		await this.page.evaluate( ( { id } ) => {
			$e.run( 'document/elements/select', {
				container: elementor.getContainer( id ),
			} );
		}, { id: elementId } );

		await this.getPreviewFrame().waitForSelector( '.elementor-element-' + elementId + '.elementor-element-editable' );
		return this.getPreviewFrame().locator( '.elementor-element-' + elementId );
	}

	/**
	 * Open the section that adds a new element.
	 *
	 * @param {string} elementId - Element ID.
	 *
	 * @return {Promise<void>}
	 */
	async openAddElementSection( elementId: string ): Promise<void> {
		const element = this.getPreviewFrame().locator( `.elementor-edit-mode .elementor-element-${ elementId }` );
		await element.hover();
		const elementAddButton = this.getPreviewFrame().locator( `.elementor-edit-mode .elementor-element-${ elementId } > .elementor-element-overlay > .elementor-editor-element-settings > .elementor-editor-element-add` );
		await elementAddButton.click();
		await this.getPreviewFrame().waitForSelector( '.elementor-add-section-inline' );
	}

	async setWidgetTab( tab: 'content' | 'style' | 'advanced' ): Promise<void> {
		await this.page.locator( `.elementor-tab-control-${ tab }` ).click();
	}

	/**
	 * Open a tab inside an Editor panel.
	 *
	 * @param {string} panelId - The panel tab to open.
	 *
	 * @return {Promise<void>}
	 */
	async openPanelTab( panelId: string ): Promise<void> {
		await this.page.waitForSelector( `.elementor-tab-control-${ panelId } span` );

		// Check if panel has been activated already.
		if ( await this.page.$( `.elementor-tab-control-${ panelId }.elementor-active` ) ) {
			return;
		}

		await this.page.locator( `.elementor-tab-control-${ panelId } span` ).click();
		await this.page.waitForSelector( `.elementor-tab-control-${ panelId }.elementor-active` );
	}

	/**
	 * Open a tab inside an Editor panel for V2 widgets.
	 *
	 * @param {'style' | 'general'} sectionName - The section to open.
	 *
	 * @return {Promise<void>}
	 */
	async openV2PanelTab( sectionName: 'style' | 'general' ) {
		const selectorMap: Record< 'style' | 'general', string > = {
			style: 'style',
			general: 'settings',
		};
		const sectionButtonSelector = `#tab-0-${ selectorMap[ sectionName ] }`,
			sectionContentSelector = `#tabpanel-0-${ selectorMap[ sectionName ] }`,
			isOpenSection = await this.page.evaluate( ( selector ) => {
				const sectionContentElement: HTMLElement = document.querySelector( selector );

				return ! sectionContentElement?.hidden;
			}, sectionContentSelector );

		if ( isOpenSection ) {
			return;
		}

		await this.page.locator( sectionButtonSelector ).click();
		await this.page.locator( sectionContentSelector ).waitFor();
	}

	/**
	 * Open a section in an active panel tab.
	 *
	 * @param {string} sectionId - The section to open.
	 *
	 * @return {Promise<void>}
	 */
	async openSection( sectionId: string ): Promise<void> {
		const sectionSelector = `.elementor-control-${ sectionId }`,
			isOpenSection = await this.page.evaluate( ( selector ) => {
				const sectionElement = document.querySelector( selector );

				return sectionElement?.classList.contains( 'e-open' ) || sectionElement?.classList.contains( 'elementor-open' );
			}, sectionSelector ),
			section = await this.page.$( sectionSelector + ':not( .e-open ):not( .elementor-open ):visible' );

		if ( ! section || isOpenSection ) {
			return;
		}

		await this.page.locator( sectionSelector + ':not( .e-open ):not( .elementor-open ):visible' + ' .elementor-panel-heading' ).click();
	}

	/**
	 * Close a section in an active panel tab.
	 *
	 * @param {string} sectionId - The section to close.
	 *
	 * @return {Promise<void>}
	 */
	async closeSection( sectionId: string ): Promise<void> {
		const sectionSelector = `.elementor-control-${ sectionId }`,
			isOpenSection = await this.page.evaluate( ( selector ) => {
				const sectionElement = document.querySelector( selector );

				return sectionElement?.classList.contains( 'e-open' ) || sectionElement?.classList.contains( 'elementor-open' );
			}, sectionSelector ),
			section = await this.page.$( sectionSelector + '.e-open:visible' );

		if ( ! section || ! isOpenSection ) {
			return;
		}

		await this.page.locator( sectionSelector + '.e-open:visible .elementor-panel-heading' ).click();
	}

	/**
	 * Open a section in an active panel tab.
	 *
	 * @param {string} sectionId - The section to open.
	 *
	 * @return {Promise<void>}
	 */
	async openV2Section( sectionId: 'layout' | 'spacing' | 'size' | 'position' | 'typography' | 'background' | 'border' ) {
		const sectionButton = this.page.locator( '.MuiButtonBase-root', { hasText: new RegExp( sectionId, 'i' ) } );
		const contentSelector = await sectionButton.getAttribute( 'aria-controls' );
		const isContentVisible = await this.page.evaluate( ( selector ) => {
			return !! document.getElementById( selector );
		}, contentSelector );

		if ( isContentVisible ) {
			return;
		}

		await sectionButton.click();
	}

	/**
	 * Set a custom width value to a widget.
	 *
	 * @param {string} width - Optional. The custom width value (as a percentage). Default is '100'.
	 *
	 * @return {Promise<void>}
	 */
	async setWidgetCustomWidth( width: string = '100' ): Promise<void> {
		await this.openPanelTab( 'advanced' );
		await this.setSelectControlValue( '_element_width', 'initial' );
		await this.setSliderControlValue( '_element_custom_width', width );
	}

	/**
	 * Set tab control value.
	 *
	 * @param {string} controlId - The control to select.
	 * @param {string} tabId     - The tab to select.
	 *
	 * @return {Promise<void>}
	 */
	async setTabControlValue( controlId: string, tabId: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } .elementor-control-${ tabId }` ).first().click();
	}

	/**
	 * Set text control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} value     - The value to set.
	 *
	 * @return {Promise<void>}
	 */
	async setTextControlValue( controlId: string, value: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } input` ).nth( 0 ).fill( value.toString() );
	}

	/**
	 * Set textarea control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} value     - The value to set.
	 *
	 * @return {Promise<void>}
	 */
	async setTextareaControlValue( controlId: string, value: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } textarea` ).fill( value.toString() );
	}

	/**
	 * Set number control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} value     - The value to set.
	 *
	 * @return {Promise<void>}
	 */
	async setNumberControlValue( controlId: string, value: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } input >> nth=0` ).fill( value.toString() );
	}

	/**
	 * Set slider control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} value     - The value to set.
	 */
	async setSliderControlValue( controlId: string, value: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } .elementor-slider-input input` ).fill( value );
	}

	/**
	 * Set select control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} value     - The value to set.
	 *
	 * @return {Promise<void>}
	 */
	async setSelectControlValue( controlId: string, value: string ): Promise<void> {
		await this.page.selectOption( `.elementor-control-${ controlId } select`, value );
	}

	/**
	 * Set select2 control value.
	 *
	 * @param {string}  controlId  - The control to set the value to.
	 * @param {string}  value      - The value to set.
	 * @param {boolean} exactMatch - Optional. Select only items that exactly match the provided value. Default is true.
	 *
	 * @return {Promise<void>}
	 */
	async setSelect2ControlValue( controlId: string, value: string, exactMatch: boolean = true ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } .select2:not( .select2-container--disabled )` ).click();
		await this.page.locator( '.select2-search--dropdown input[type="search"]' ).fill( value );

		if ( exactMatch ) {
			await this.page.locator( `.select2-results__option:text-is("${ value }")` ).first().click();
		} else {
			await this.page.locator( `.select2-results__option:has-text("${ value }")` ).first().click();
		}

		await this.page.waitForLoadState( 'domcontentloaded' );
	}

	/**
	 * Set dimensions control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} value     - The value to set.
	 *
	 * @return {Promise<void>}
	 */
	async setDimensionsValue( controlId: string, value: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } .elementor-control-dimensions li:first-child input` ).fill( value );
	}

	/**
	 * Set choose control value.
	 *
	 * TODO: For consistency, we need to rewrite the logic, from icon based to value based.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} icon      - The icon to choose.
	 *
	 * @return {Promise<void>}
	 */
	async setChooseControlValue( controlId: string, icon: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } .${ icon }` ).click();
	}

	/**
	 * Set color control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} value     - The value to set.
	 *
	 * @return {Promise<void>}
	 */
	async setColorControlValue( controlId: string, value: string ): Promise<void> {
		const controlSelector = `.elementor-control-${ controlId }`;

		await this.page.locator( controlSelector + ' .pcr-button' ).click();
		await this.page.locator( '.pcr-app.visible .pcr-interaction input.pcr-result' ).fill( value );
		await this.page.locator( controlSelector ).click();
	}

	/**
	 * Set switcher control value.
	 *
	 * @param {string}  controlId - The control to set the value to.
	 * @param {boolean} value     - Optional. The value to set (true|false). Default is true.
	 *
	 * @return {Promise<void>}
	 */
	async setSwitcherControlValue( controlId: string, value: boolean = true ): Promise<void> {
		const controlSelector = `.elementor-control-${ controlId }`,
			controlLabel = this.page.locator( controlSelector + ' label.elementor-switch' ),
			currentState = await this.page.locator( controlSelector + ' input[type="checkbox"]' ).isChecked();

		if ( currentState !== Boolean( value ) ) {
			await controlLabel.click();
		}
	}

	/**
	 * Set an image on a media control.
	 *
	 * @param {string}  controlId  - The control to set the value to.
	 * @param {boolean} imageTitle - The title of the image to set.
	 *
	 * @return {Promise<void>}
	 */
	async setMediaControlImageValue( controlId: string, imageTitle: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId } .elementor-control-media__preview` ).click();
		await this.page.getByRole( 'tab', { name: 'Media Library' } ).click();
		await this.page.locator( `[aria-label="${ imageTitle }"]` ).click();
		await this.page.locator( '.button.media-button' ).click();
	}

	/**
	 * Set typography control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} fontsize  - Font size value.
	 *
	 * @return {Promise<void>}
	 */
	async setTypographyControlValue( controlId: string, fontsize: string ): Promise<void> {
		const controlSelector = `.elementor-control-${ controlId }_typography .eicon-edit`;

		await this.page.locator( controlSelector ).click();
		await this.setSliderControlValue( controlId + '_font_size', fontsize );
		await this.page.locator( controlSelector ).click();
	}

	/**
	 * Set shadow control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} type      - Shadow type. Available options are 'text' or 'box.
	 *
	 * @return {Promise<void>}
	 */
	async setShadowControlValue( controlId: string, type: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId }_${ type }_shadow_type i.eicon-edit` ).click();
		await this.page.locator( `.elementor-control-${ controlId }_${ type }_shadow_type label` ).first().click();
	}

	/**
	 * Set text stroke control value.
	 *
	 * @param {string} controlId - The control to set the value to.
	 * @param {string} type      - Stroke type. Available options are 'text' or 'box.
	 * @param {number} value     - Stroke value.
	 * @param {string} color     - Stroke color.
	 *
	 * @return {Promise<void>}
	 */
	async setTextStrokeControlValue( controlId: string, type: string, value: number, color: string ): Promise<void> {
		await this.page.locator( `.elementor-control-${ controlId }_${ type }_stroke_type i.eicon-edit` ).click();
		await this.page.locator( `.elementor-control-${ controlId }_${ type }_stroke input[type="number"]` ).first().fill( value.toString() );
		await this.page.locator( `.elementor-control-${ controlId }_stroke_color .pcr-button` ).first().click();
		await this.page.locator( '.pcr-app.visible .pcr-result' ).first().fill( color );
		await this.page.locator( `.elementor-control-${ controlId }_${ type }_stroke_type label` ).first().click();
	}

	/**
	 * Set a widget mask.
	 *
	 * @return {Promise<void>}
	 */
	async setWidgetMask(): Promise<void> {
		await this.openSection( '_section_masking' );
		await this.setSwitcherControlValue( '_mask_switch', true );
		await this.setSelectControlValue( '_mask_size', 'custom' );
		await this.setSliderControlValue( '_mask_size_scale', '30' );
		await this.setSelectControlValue( '_mask_position', 'top right' );
	}

	/**
	 * Hide controls from the video widgets.
	 *
	 * @return {Promise<void>}
	 */
	async hideVideoControls(): Promise<void> {
		await this.getPreviewFrame().waitForSelector( '.elementor-video' );

		const videoFrame = this.getPreviewFrame().frameLocator( '.elementor-video' ),
			videoButton = videoFrame.locator( 'button.ytp-large-play-button.ytp-button.ytp-large-play-button-red-bg' ),
			videoGradient = videoFrame.locator( '.ytp-gradient-top' ),
			videoTitle = videoFrame.locator( '.ytp-show-cards-title' ),
			videoBottom = videoFrame.locator( '.ytp-impression-link' );

		await videoButton.evaluate( ( element ) => element.style.opacity = '0' );
		await videoGradient.evaluate( ( element ) => element.style.opacity = '0' );
		await videoTitle.evaluate( ( element ) => element.style.opacity = '0' );
		await videoBottom.evaluate( ( element ) => element.style.opacity = '0' );
	}

	/**
	 * Hide controls and overlays on map widgets.
	 *
	 * @return {Promise<void>}
	 */
	async hideMapControls(): Promise<void> {
		await this.getPreviewFrame().waitForSelector( '.elementor-widget-google_maps iframe' );

		const mapFrame = this.getPreviewFrame().frameLocator( '.elementor-widget-google_maps iframe' ),
			mapText = mapFrame.locator( '.gm-style iframe + div + div' ),
			mapInset = mapFrame.locator( 'button.gm-inset-map.gm-inset-light' ),
			mapControls = mapFrame.locator( '.gmnoprint.gm-bundled-control.gm-bundled-control-on-bottom' );

		await mapText.evaluate( ( element ) => element.style.opacity = '0' );
		await mapInset.evaluate( ( element ) => element.style.opacity = '0' );
		await mapControls.evaluate( ( element ) => element.style.opacity = '0' );
	}

	/**
	 * Open the page in the Preview mode.
	 *
	 * @return {Promise<void>}
	 */
	async togglePreviewMode(): Promise<void> {
		if ( ! await this.page.$( 'body.elementor-editor-preview' ) ) {
			await this.page.locator( '#elementor-mode-switcher' ).click();
			await this.page.waitForSelector( 'body.elementor-editor-preview' );
			await this.page.waitForTimeout( 500 );
		} else {
			await this.page.locator( '#elementor-mode-switcher-preview' ).click();
			await this.page.waitForSelector( 'body.elementor-editor-active' );
		}
	}

	/**
	 * Wait for the Elementor preview to finish loading.
	 *
	 * @return {Promise<void>}
	 */
	async waitForPreviewToLoad(): Promise<void> {
		await this.page.waitForSelector( '#elementor-preview-loading' );
		await this.page.waitForSelector( '#elementor-preview-loading', { state: 'hidden' } );
	}

	/**
	 * Hide all editor elements from the screenshots.
	 *
	 * @return {Promise<void>}
	 */
	async hideEditorElements(): Promise<void> {
		const css = '<style>.elementor-element-overlay,.elementor-empty-view{opacity: 0;}.elementor-widget,.elementor-widget:hover{box-shadow:none!important;}</style>';

		await this.addWidget( 'html' );
		await this.setTextareaControlValue( 'type-code', css );
	}

	/**
	 * Whether the Top Bar is active or not.
	 *
	 * @return {Promise<boolean>}
	 */
	async hasTopBar(): Promise<boolean> {
		return await this.page.locator( EditorSelectors.panels.topBar.wrapper ).isVisible();
	}

	/**
	 * Click on a top bar item.
	 *
	 * @param {TopBarSelector} selector - The selector object for the top bar button.
	 *
	 * @return {Promise<void>}
	 */
	async clickTopBarItem( selector: TopBarSelector ): Promise<void> {
		const topbarLocator = this.page.locator( EditorSelectors.panels.topBar.wrapper );
		if ( 'text' === selector.attribute ) {
			await topbarLocator.getByRole( 'button', { name: selector.attributeValue } ).click();
		} else {
			await topbarLocator.locator( `button[${ selector.attribute }="${ selector.attributeValue }"]` ).click();
		}
	}

	/**
	 * Open the menu panel. Or, when an inner panel is provided, open the inner panel.
	 *
	 * TODO: Delete when Editor Top Bar feature is merged.
	 *
	 * @param {string} innerPanel - Optional. The inner menu to open.
	 *
	 * @return {Promise<void>}
	 */
	async openMenuPanel( innerPanel?: string ): Promise<void> {
		await this.page.locator( EditorSelectors.panels.menu.footerButton ).click();
		await this.page.locator( EditorSelectors.panels.menu.wrapper ).waitFor();

		if ( innerPanel ) {
			await this.page.locator( `.elementor-panel-menu-item-${ innerPanel }` ).click();
		}
	}

	/**
	 * Open the elements/widgets panel.
	 *
	 * @return {Promise<void>}
	 */
	async openElementsPanel(): Promise<void> {
		const hasTopBar = await this.hasTopBar();

		if ( hasTopBar ) {
			await this.clickTopBarItem( TopBarSelectors.elementsPanel );
		} else {
			await this.page.locator( EditorSelectors.panels.elements.footerButton ).click();
		}

		await this.page.locator( EditorSelectors.panels.elements.wrapper ).waitFor();
	}

	/**
	 * Open the page settings panel.
	 *
	 * @return {Promise<void>}
	 */
	async openPageSettingsPanel(): Promise<void> {
		const hasTopBar = await this.hasTopBar();

		if ( hasTopBar ) {
			await this.clickTopBarItem( TopBarSelectors.documentSettings );
		} else {
			await this.page.locator( EditorSelectors.panels.pageSettings.footerButton ).click();
		}

		await this.page.locator( EditorSelectors.panels.pageSettings.wrapper ).waitFor();
	}

	/**
	 * Open the site settings panel. Or, when an inner panel is provided, open the inner panel.
	 *
	 * @param {string} innerPanel - Optional. The inner menu to open.
	 *
	 * @return {Promise<void>}
	 */
	async openSiteSettings( innerPanel?: string ): Promise<void> {
		const hasTopBar = await this.hasTopBar();

		if ( hasTopBar ) {
			await this.clickTopBarItem( TopBarSelectors.siteSettings );
		} else {
			await this.openMenuPanel( 'global-settings' );
		}

		await this.page.locator( EditorSelectors.panels.siteSettings.wrapper ).waitFor();

		if ( innerPanel ) {
			await this.page.locator( `.elementor-panel-menu-item-settings-${ innerPanel }` ).click();
		}
	}

	/**
	 * Open the user preferences panel.
	 *
	 * @return {Promise<void>}
	 */
	async openUserPreferencesPanel(): Promise<void> {
		const hasTopBar = await this.hasTopBar();

		if ( hasTopBar ) {
			await this.clickTopBarItem( TopBarSelectors.elementorLogo );
			await this.page.waitForTimeout( 100 );
			await this.page.getByRole( 'menuitem', { name: 'User Preferences' } ).click();
		} else {
			await this.openMenuPanel( 'editor-preferences' );
		}

		await this.page.locator( EditorSelectors.panels.userPreferences.wrapper ).waitFor();
	}

	/**
	 * Close the navigator/structure panel.
	 *
	 * @return {Promise<void>}
	 */
	async closeNavigatorIfOpen(): Promise<void> {
		const isOpen = await this.getPreviewFrame().evaluate( () => elementor.navigator.isOpen() );

		if ( ! isOpen ) {
			return;
		}

		await this.page.locator( EditorSelectors.panels.navigator.closeButton ).click();
	}

	/**
	 * Set WordPress page template.
	 *
	 * @param {string} template - The page template to set. Available options: 'default', 'canvas', 'full-width'.
	 *
	 * @return {Promise<void>}
	 */
	async setPageTemplate( template: 'default' | 'canvas' | 'full-width' ): Promise<void> {
		let templateValue;
		let templateClass;

		switch ( template ) {
			case 'default':
				templateValue = 'default';
				templateClass = '.elementor-default';
				break;
			case 'canvas':
				templateValue = 'elementor_canvas';
				templateClass = '.elementor-template-canvas';
				break;
			case 'full-width':
				templateValue = 'elementor_header_footer';
				templateClass = '.elementor-template-full-width';
				break;
		}

		// Check if the template is already set
		if ( await this.getPreviewFrame().$( templateClass ) ) {
			return;
		}

		// Select the template
		await this.openPageSettingsPanel();
		await this.setSelectControlValue( 'template', templateValue );
		await this.getPreviewFrame().waitForSelector( templateClass );
	}

	/**
	 * Change the display mode of the editor.
	 *
	 * @param {string} uiMode - Either 'light', 'dark', or 'auto'.
	 *
	 * @return {Promise<void>}
	 */
	async setDisplayMode( uiMode: string ):	Promise<void> {
		const uiThemeOptions = {
			light: 'eicon-light-mode',
			dark: 'eicon-dark-mode',
			auto: 'eicon-header',
		};

		await this.openUserPreferencesPanel();
		await this.setChooseControlValue( 'ui_theme', uiThemeOptions[ uiMode ] );
	}

	/**
	 * Open the responsive view bar.
	 *
	 * TODO: Delete when Editor Top Bar feature is merged.
	 *
	 * @return {Promise<void>}
	 */
	async openResponsiveViewBar(): Promise<void> {
		const hasResponsiveViewBar = await this.page.evaluate( () => elementor.isDeviceModeActive() );

		if ( ! hasResponsiveViewBar ) {
			await this.page.locator( '#elementor-panel-footer-responsive i' ).click();
		}
	}

	/**
	 * Select a responsive view.
	 *
	 * @param {Device} device - The name of the device breakpoint, such as `tablet_extra`.
	 *
	 * @return {Promise<void>}
	 */
	async changeResponsiveView( device: Device ): Promise<void> {
		const hasTopBar = await this.hasTopBar();
		if ( hasTopBar ) {
			await Breakpoints.getDeviceLocator( this.page, device ).click();
		} else {
			await this.openResponsiveViewBar();
			await this.page.locator( `#e-responsive-bar-switcher__option-${ device }` ).first().locator( 'i' ).click();
		}
	}

	/**
	 * Publish the current page.
	 *
	 * @return {Promise<void>}
	 */
	async publishPage(): Promise<void> {
		const hasTopBar = await this.hasTopBar();

		if ( hasTopBar ) {
			await this.clickTopBarItem( TopBarSelectors.publish );
			await this.page.waitForLoadState();
			await this.page.locator( EditorSelectors.panels.topBar.wrapper + ' button[disabled]', { hasText: 'Publish' } ).waitFor();
		} else {
			await this.page.locator( 'button#elementor-panel-saver-button-publish' ).click();
			await this.page.waitForLoadState();
			await this.page.getByRole( 'button', { name: 'Update' } ).waitFor();
		}
	}

	/**
	 * Publish the current page and view it.
	 *
	 * @return {Promise<void>}
	 */
	async publishAndViewPage(): Promise<void> {
		const hasTopBar = await this.hasTopBar();

		await this.publishPage();

		if ( hasTopBar ) {
			await this.clickTopBarItem( TopBarSelectors.saveOptions );
			await this.page.getByRole( 'menuitem', { name: 'View Page' } ).click();
			const pageId = await this.getPageId();
			await this.page.goto( `/?p=${ pageId }` );
		} else {
			await this.openMenuPanel( 'view-page' );
		}

		await this.page.waitForLoadState();
	}

	async viewPage() {
		const pageId = await this.getPageId();
		await this.page.goto( `/?p=${ pageId }` );
		await this.page.waitForLoadState();
	}

	/**
	 * Save and reload the current page.
	 *
	 * @return {Promise<void>}
	 */
	async saveAndReloadPage(): Promise<void> {
		const hasTopBar = await this.hasTopBar();

		if ( hasTopBar ) {
			await this.clickTopBarItem( TopBarSelectors.publish );
		} else {
			await this.page.locator( '#elementor-panel-saver-button-publish' ).click();
		}

		await this.page.waitForLoadState();
		await this.page.waitForResponse( '/wp-admin/admin-ajax.php' );
		await this.page.reload();
	}

	/**
	 * Get the current page ID.
	 *
	 * @return {Promise<string>}
	 */
	async getPageId(): Promise<string> {
		return await this.page.evaluate( () => elementor.config.initial_document.id );
	}

	/**
	 * Apply Element Settings
	 *
	 * Apply settings to a widget without having to navigate through its Panels and Sections to set each individual
	 * control value.
	 *
	 * You can get the Element settings by right-clicking an existing widget or element in the Editor, choose "Copy",
	 * then paste the content into a text editor and filter out just the settings you want to apply to your element.
	 *
	 * Example usage:
	 * ```
	 * await editor.applyElementSettings( 'cdefd82', {
	 *     background_background: 'classic',
	 *     background_color: 'rgb(255, 10, 10)',
	 * } );
	 * ```
	 *
	 * @param {string} elementId - Id of the element you intend to apply the settings to.
	 * @param {Object} settings  - Object settings from the Editor > choose element > right-click > "Copy".
	 *
	 * @return {Promise<void>}
	 */
	async applyElementSettings( elementId: string, settings: unknown ): Promise<void> {
		await this.page.evaluate(
			( args ) => $e.run( 'document/elements/settings', {
				container: elementor.getContainer( args.elementId ),
				settings: args.settings,
			} ),
			{ elementId, settings },
		);
	}

	/**
	 * Check if an item is in the viewport.
	 *
	 * @param {string} itemSelector - The item selector.
	 *
	 * @return {Promise<boolean>}
	 */
	async isItemInViewport( itemSelector: string ): Promise<boolean> {
		return this.page.evaluate( ( item: string ) => {
			let isVisible = false;

			const element: HTMLElement = document.querySelector( item );

			if ( element ) {
				const rect = element.getBoundingClientRect();

				if ( rect.top >= 0 && rect.left >= 0 ) {
					const vw = Math.max( document.documentElement.clientWidth || 0, window.innerWidth || 0 ),
						vh = Math.max( document.documentElement.clientHeight || 0, window.innerHeight || 0 );

					if ( rect.right <= vw && rect.bottom <= vh ) {
						isVisible = true;
					}
				}
			}
			return isVisible;
		}, itemSelector );
	}

	/**
	 * Get the number of widgets in the editor.
	 *
	 * @return {Promise<number>}
	 */
	async getWidgetCount(): Promise<number> {
		return ( await this.getPreviewFrame().$$( EditorSelectors.widget ) ).length;
	}

	/**
	 * Based on the widget type, wait for the iframe to load.
	 *
	 * @param {string}  widgetType  - The widget type. Available options: 'video', 'google_maps', 'sound_cloud'.
	 * @param {boolean} isPublished - Optional. Whether the element is published. Default is false.
	 *
	 * @return {Promise<void>}
	 */
	async waitForIframeToLoaded( widgetType: string, isPublished: boolean = false ): Promise<void> {
		const frames = {
			video: [ EditorSelectors.video.iframe, EditorSelectors.video.playIcon ],
			google_maps: [ EditorSelectors.googleMaps.iframe, EditorSelectors.googleMaps.showSatelliteViewBtn ],
			sound_cloud: [ EditorSelectors.soundCloud.iframe, EditorSelectors.soundCloud.waveForm ],
		};

		if ( ! ( widgetType in frames ) ) {
			return;
		}

		if ( isPublished ) {
			await this.page.locator( frames[ widgetType ][ 0 ] ).first().waitFor();
			const count = await this.page.locator( frames[ widgetType ][ 0 ] ).count();
			for ( let i = 1; i < count; i++ ) {
				await this.page.frameLocator( frames[ widgetType ][ 0 ] ).nth( i ).locator( frames[ widgetType ][ 1 ] ).waitFor();
			}
		} else {
			const frame = this.getPreviewFrame();
			await frame.waitForLoadState();
			await frame.waitForSelector( frames[ widgetType ][ 0 ] );
			await frame.frameLocator( frames[ widgetType ][ 0 ] ).first().locator( frames[ widgetType ][ 1 ] ).waitFor();
			const iframeCount: number = await new Promise( ( resolved ) => {
				resolved( frame.childFrames().length );
			} );
			for ( let i = 1; i < iframeCount; i++ ) {
				await frame.frameLocator( frames[ widgetType ][ 0 ] ).nth( i ).locator( frames[ widgetType ][ 1 ] ).waitFor();
			}
		}
	}

	/**
	 * Wait for the element to be visible.
	 *
	 * @param {boolean} isPublished - Whether the element is published.
	 * @param {string}  selector    - Element selector.
	 *
	 * @return {Promise<void>}
	 */
	async waitForElement( isPublished: boolean, selector: string ): Promise<void> {
		if ( selector === undefined ) {
			return;
		}

		if ( isPublished ) {
			await this.page.waitForSelector( selector );
		} else {
			const frame = this.getPreviewFrame();
			await frame.waitForLoadState();
			await frame.waitForSelector( selector );
		}
	}

	/**
	 * Verify class in element.
	 *
	 * @param {Object}  args             - Arguments.
	 * @param {string}  args.selector    - Element selector.
	 * @param {string}  args.className   - Class name.
	 * @param {boolean} args.isPublished - Whether the element is published.
	 *
	 * @return {Promise<void>}
	 */
	async verifyClassInElement( args: { selector: string, className: string, isPublished: boolean } ): Promise<void> {
		const regex = new RegExp( args.className );
		if ( args.isPublished ) {
			await expect( this.page.locator( args.selector ) ).toHaveClass( regex );
		} else {
			await expect( this.getPreviewFrame().locator( args.selector ) ).toHaveClass( regex );
		}
	}

	/**
	 * Verify image size.
	 *
	 * @param {Object}  args             - Arguments.
	 * @param {string}  args.selector    - Element selector.
	 * @param {number}  args.width       - Image width.
	 * @param {number}  args.height      - Image height.
	 * @param {boolean} args.isPublished - Whether the element is published.
	 *
	 * @return {Promise<void>}
	 */
	async verifyImageSize( args: { selector: string, width: number, height: number, isPublished: boolean } ): Promise<void> {
		const imageSize = args.isPublished
			? await this.page.locator( args.selector ).boundingBox()
			: await this.getPreviewFrame().locator( args.selector ).boundingBox();
		expect( imageSize.width ).toEqual( args.width );
		expect( imageSize.height ).toEqual( args.height );
	}

	/**
	 * Checks for a stable UI state by comparing screenshots at intervals and expecting a match.
	 * Can be used to check for completed rendering. Useful to wait out animations before screenshots and expects.
	 * Should be less flaky than waitForLoadState( 'load' ) in editor where Ajax re-rendering is triggered.
	 *
	 * @param {Locator} locator - The locator to check for.
	 * @param {number}  retries - Optional. Number of retries. Default is 3.
	 * @param {number}  timeout - Optional. Time to wait between retries, in milliseconds. Default is 500.
	 *
	 * @return {Promise<void>}
	 */
	async isUiStable( locator: Locator, retries: number = 3, timeout: number = 500 ): Promise<void> {
		const comparator = getComparator( 'image/png' );
		let retry = 0,
			beforeImage,
			afterImage;

		do {
			if ( retry === retries ) {
				break;
			}

			beforeImage = await locator.screenshot( {
				path: `./before.png`,
			} );

			await new Promise( ( resolve ) => setTimeout( resolve, timeout ) );

			afterImage = await locator.screenshot( {
				path: `./after.png`,
			} );
			retry = retry++;
		} while ( null !== comparator( beforeImage, afterImage ) );
	}

	/**
	 * Run accessibility test using @Axe-Core.
	 *
	 * @param {Page}   page     - Playwright page instance.
	 * @param {string} selector - The selector to test.
	 *
	 * @return {Promise<void>}
	 */
	async axeCoreAccessibilityTest( page, selector: string ): Promise<void> {
		const accessibilityScanResults = await new AxeBuilder( { page } ).include( selector ).analyze();
		expect.soft( accessibilityScanResults.violations ).toEqual( [] );
	}

	/**
	 * Remove classes from the page.
	 *
	 * @param {string} className - The class to remove.
	 *
	 * @return {Promise<void>}
	 */
	async removeClasses( className: string ): Promise<void> {
		await this.page.evaluate( async ( _class ) => {
			await new Promise( ( resolve1 ) => {
				const elems = document.querySelectorAll( `.${ _class }` );

				[].forEach.call( elems, function( el: HTMLElement ) {
					el.classList.remove( _class );
				} );
				resolve1( 'Foo' );
			} );
		}, className );
	}

	/**
	 * Scroll the page.
	 *
	 * @return {Promise<void>}
	 */
	async scrollPage(): Promise<void> {
		await this.page.evaluate( async () => {
			await new Promise( ( resolve1 ) => {
				let totalHeight = 0;
				const distance = 400;
				const timer = setInterval( () => {
					const scrollHeight = document.body.scrollHeight;
					window.scrollBy( 0, distance );
					totalHeight += distance;
					if ( totalHeight >= scrollHeight ) {
						clearInterval( timer );
						window.scrollTo( 0, 0 );
						resolve1( 'Foo' );
					}
				}, 100 );
			} );
		} );
	}

	/**
	 * Remove the WordPress admin bar.
	 *
	 * @return {Promise<void>}
	 */
	async removeWpAdminBar(): Promise<void> {
		const adminBar = 'wpadminbar';
		await this.page.locator( `#${ adminBar }` ).waitFor( { timeout: 10000 } );
		await this.page.evaluate( ( selector ) => {
			const admin = document.getElementById( selector );
			admin.remove();
		}, adminBar );
	}

	/**
	 * Isolated ID number.
	 *
	 * @param {string} idPrefix - The prefix of the item.
	 * @param {string} itemID   - The item ID.
	 *
	 * @return {Promise<number>}
	 */
	async isolatedIdNumber( idPrefix: string, itemID: string ): Promise<number> {
		return Number( itemID.replace( idPrefix, '' ) );
	}

	async addImagesToGalleryControl( args?: { images?: string[], metaData?: boolean } ) {
		const defaultImages = [ 'A.jpg', 'B.jpg', 'C.jpg', 'D.jpg', 'E.jpg' ];

		await this.page.locator( EditorSelectors.galleryControl.addGalleryBtn ).nth( 0 ).click();
		await this.page.getByRole( 'tab', { name: 'Media Library' } ).click();

		const _images = args?.images === undefined ? defaultImages : args.images;

		for ( const i in _images ) {
			await this.page.setInputFiles( EditorSelectors.media.imageInp, pathResolve( __dirname, `../resources/${ _images[ i ] }` ) );

			if ( args?.metaData ) {
				await this.addTestImageMetaData();
			}
		}

		await this.page.locator( EditorSelectors.media.addGalleryButton ).click();
		await this.page.locator( 'text=Insert gallery' ).click();
	}

	async addTestImageMetaData( args = { caption: 'Test caption!', description: 'Test description!' } ) {
		await this.page.locator( EditorSelectors.media.images ).first().click();
		await this.page.locator( EditorSelectors.media.imgCaption ).clear();
		await this.page.locator( EditorSelectors.media.imgCaption ).type( args.caption );

		await this.page.locator( EditorSelectors.media.images ).first().click();
		await this.page.locator( EditorSelectors.media.imgDescription ).clear();
		await this.page.locator( EditorSelectors.media.imgDescription ).type( args.description );
	}

	/**
	 * Save the site settings with the top bar.
	 *
	 * TODO: Rename when Editor Top Bar feature is merged.
	 *
	 * @param {boolean} toReload - Whether to reload the page after saving.
	 *
	 * @return {Promise<void>}
	 */
	async saveSiteSettingsWithTopBar( toReload: boolean ): Promise<void> {
		if ( await this.page.locator( EditorSelectors.panels.siteSettings.saveButton ).isEnabled() ) {
			await this.page.locator( EditorSelectors.panels.siteSettings.saveButton ).click();
		} else {
			await this.page.evaluate( ( selector ) => {
				const button: HTMLElement = document.evaluate( selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE ).singleNodeValue as HTMLElement;
				button.click();
			}, EditorSelectors.panels.siteSettings.saveButton );
		}

		if ( toReload ) {
			await this.page.locator( EditorSelectors.refreshPopup.reloadButton ).click();
		}
	}

	/**
	 * Save the site settings without the top bar.
	 *
	 * TODO: Delete when Editor Top Bar feature is merged.
	 *
	 * @return {Promise<void>}
	 */
	async saveSiteSettingsNoTopBar(): Promise<void> {
		await this.page.locator( EditorSelectors.panels.footerTools.updateButton ).click();
		await this.page.locator( EditorSelectors.toast ).waitFor();
	}

	async assertCorrectVwWidthStylingOfElement( element: Locator, vwValue: number = 100 ): Promise<void> {
		const viewport = this.page.viewportSize();
		const vwConvertedToPxUnit = viewport.width * vwValue / 100;
		const elementWidthInPxUnit = await element.boundingBox().then( ( box ) => box?.width ?? 0 );
		const vwAndPxValuesAreEqual = Math.abs( vwConvertedToPxUnit - elementWidthInPxUnit ) <= 1;
		expect( vwAndPxValuesAreEqual ).toBeTruthy();
	}
}