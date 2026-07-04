import { standalone_routes } from '@/components/shared';
import { useDevice } from '@deriv-com/ui';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();

    if (!isDesktop) return null;
    return (
        <a
            className='app-header__logo royal-logo-link'
            href={standalone_routes.bot}
            aria-label='Royal Trading Tools'
        >
            <svg viewBox='0 0 100 100' width='30' height='30' xmlns='http://www.w3.org/2000/svg'>
                <rect width='100' height='100' rx='16' fill='#b7410e' />
                <polygon points='14,52 14,28 30,42 50,14 70,42 86,28 86,52' fill='white' />
                <rect x='12' y='50' width='76' height='10' rx='4' fill='white' />
                <rect x='22' y='64' width='11' height='24' rx='3' fill='white' />
                <rect x='22' y='64' width='34' height='10' rx='5' fill='white' />
                <rect x='22' y='72' width='30' height='9' rx='4' fill='white' />
                <line x1='44' y1='79' x2='66' y2='93' stroke='white' strokeWidth='11' strokeLinecap='round' />
            </svg>
            <span className='royal-logo-wordmark'>
                <span className='royal-logo-title'>Royal</span>
                <span className='royal-logo-sub'>Trading Tools</span>
            </span>
        </a>
    );
};
