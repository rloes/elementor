import * as React from 'react';
import { SvgIcon, SvgIconProps } from '@elementor/ui';

const ThemeBuilderIcon = React.forwardRef( ( props: SvgIconProps, ref ) => {
	return (
		<SvgIcon viewBox="0 0 24 24" { ...props } ref={ ref }>
			<path fillRule="evenodd" clipRule="evenodd" d="M5 4.75C4.86193 4.75 4.75 4.86193 4.75 5V7C4.75 7.13807 4.86193 7.25 5 7.25H19C19.1381 7.25 19.25 7.13807 19.25 7V5C19.25 4.86193 19.1381 4.75 19 4.75H5ZM3.25 5C3.25 4.0335 4.0335 3.25 5 3.25H19C19.9665 3.25 20.75 4.0335 20.75 5V7C20.75 7.9665 19.9665 8.75 19 8.75H5C4.0335 8.75 3.25 7.9665 3.25 7V5ZM5 12.75C4.86193 12.75 4.75 12.8619 4.75 13V19C4.75 19.1381 4.86193 19.25 5 19.25H9C9.13807 19.25 9.25 19.1381 9.25 19V13C9.25 12.8619 9.13807 12.75 9 12.75H5ZM3.25 13C3.25 12.0335 4.0335 11.25 5 11.25H9C9.9665 11.25 10.75 12.0335 10.75 13V19C10.75 19.9665 9.9665 20.75 9 20.75H5C4.0335 20.75 3.25 19.9665 3.25 19V13ZM13.25 12C13.25 11.5858 13.5858 11.25 14 11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H14C13.5858 12.75 13.25 12.4142 13.25 12ZM13.25 16C13.25 15.5858 13.5858 15.25 14 15.25H20C20.4142 15.25 20.75 15.5858 20.75 16C20.75 16.4142 20.4142 16.75 20 16.75H14C13.5858 16.75 13.25 16.4142 13.25 16ZM13.25 20C13.25 19.5858 13.5858 19.25 14 19.25H20C20.4142 19.25 20.75 19.5858 20.75 20C20.75 20.4142 20.4142 20.75 20 20.75H14C13.5858 20.75 13.25 20.4142 13.25 20Z" />
		</SvgIcon>
	);
} );

export default ThemeBuilderIcon;
