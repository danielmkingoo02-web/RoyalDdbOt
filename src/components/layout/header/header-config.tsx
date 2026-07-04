import { ReactNode } from 'react';
import { standalone_routes } from '@/components/shared';
import {
    LegacyCashierIcon as CashierLogo,
    LegacyChartsIcon as AnalyticsLogo,
    LegacyDerivIcon as RobotLogo,
    LegacyHomeNewIcon as TradershubLogo,
    LegacyReportsIcon as ReportsLogo,
} from '@deriv/quill-icons/Legacy';
import {
    DerivProductBrandLightDerivBotLogoWordmarkIcon as DerivBotLogo,
    DerivProductBrandLightDerivTraderLogoWordmarkIcon as DerivTraderLogo,
    PartnersProductBrandLightSmarttraderLogoWordmarkIcon as SmarttraderLogo,
} from '@deriv/quill-icons/Logo';
import { localize } from '@deriv-com/translations';

export type PlatformsConfig = {
    active: boolean;
    buttonIcon: ReactNode;
    description: string;
    href: string;
    icon: ReactNode;
    showInEU: boolean;
};

export type MenuItemsConfig = {
    as: 'a' | 'button';
    href: string;
    icon: ReactNode;
    label: string;
};

export type TAccount = {
    balance: string;
    currency: string;
    icon: React.ReactNode;
    isActive: boolean;
    isEu: boolean;
    isVirtual: boolean;
    loginid: string;
    token: string;
    type: string;
};

export const platformsConfig: PlatformsConfig[] = [
    {
        active: false,
        buttonIcon: <DerivTraderLogo height={25} width={114.97} />,
        description: localize('A whole new trading experience on a powerful yet easy to use platform.'),
        href: standalone_routes.trade,
        icon: <DerivTraderLogo height={32} width={148} />,
        showInEU: true,
    },
    {
        active: true,
        buttonIcon: (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '14px', color: '#b7410e' }}>
                <svg viewBox='0 0 100 100' width='20' height='20' xmlns='http://www.w3.org/2000/svg'>
                    <rect width='100' height='100' rx='16' fill='#b7410e' />
                    <polygon points='14,52 14,28 30,42 50,14 70,42 86,28 86,52' fill='white' />
                    <rect x='12' y='50' width='76' height='10' rx='4' fill='white' />
                    <rect x='22' y='64' width='11' height='24' rx='3' fill='white' />
                    <rect x='22' y='64' width='34' height='10' rx='5' fill='white' />
                    <rect x='22' y='72' width='30' height='9' rx='4' fill='white' />
                    <line x1='44' y1='79' x2='66' y2='93' stroke='white' strokeWidth='11' strokeLinecap='round' />
                </svg>
                Royal Bot
            </span>
        ),
        description: localize('Automated trading at your fingertips. No coding needed.'),
        href: standalone_routes.bot,
        icon: (
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '18px', color: '#b7410e' }}>
                <svg viewBox='0 0 100 100' width='28' height='28' xmlns='http://www.w3.org/2000/svg'>
                    <rect width='100' height='100' rx='16' fill='#b7410e' />
                    <polygon points='14,52 14,28 30,42 50,14 70,42 86,28 86,52' fill='white' />
                    <rect x='12' y='50' width='76' height='10' rx='4' fill='white' />
                    <rect x='22' y='64' width='11' height='24' rx='3' fill='white' />
                    <rect x='22' y='64' width='34' height='10' rx='5' fill='white' />
                    <rect x='22' y='72' width='30' height='9' rx='4' fill='white' />
                    <line x1='44' y1='79' x2='66' y2='93' stroke='white' strokeWidth='11' strokeLinecap='round' />
                </svg>
                Royal Trading Tools
            </span>
        ),
        showInEU: false,
    },
    {
        active: false,
        buttonIcon: <SmarttraderLogo height={24} width={115} />,
        description: localize('Trade the world’s markets with our popular user-friendly platform.'),
        href: standalone_routes.smarttrader,
        icon: <SmarttraderLogo height={32} width={153} />,
        showInEU: false,
    },
];

export const TRADERS_HUB_LINK_CONFIG = {
    as: 'a',
    href: standalone_routes.traders_hub,
    icon: <TradershubLogo iconSize='xs' />,
    label: "Trader's Hub",
};

export const MenuItems: MenuItemsConfig[] = [
    {
        as: 'a',
        href: standalone_routes.cashier,
        icon: <CashierLogo iconSize='xs' />,
        label: localize('Cashier'),
    },
    {
        as: 'a',
        href: standalone_routes.reports,
        icon: <ReportsLogo iconSize='xs' />,
        label: localize('Reports'),
    },
    {
        as: 'a',
        href: standalone_routes.free_bots,
        icon: <RobotLogo iconSize='xs' />,
        label: localize('Free Bots'),
    },
    {
        as: 'a',
        href: standalone_routes.analysis_tool,
        icon: <AnalyticsLogo iconSize='xs' />,
        label: localize('Analysis Tool'),
    },
];
