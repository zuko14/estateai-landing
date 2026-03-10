/**
 * Property Portal Webhook Configuration
 * Defines webhook settings for each portal
 */

export interface PortalConfig {
  name: string;
  webhookPath: string;
  secretEnvVar: string;
  supportedFields: string[];
  phoneField: string;
  emailField: string;
  nameField: string;
}

export const portalConfigs: Record<string, PortalConfig> = {
  '99acres': {
    name: '99acres',
    webhookPath: '/webhook/99acres',
    secretEnvVar: 'NINETYNINE_ACRES_WEBHOOK_SECRET',
    supportedFields: [
      'name',
      'phone',
      'email',
      'propertyType',
      'location',
      'budgetMin',
      'budgetMax',
      'timeline',
      'purpose',
      'listingId'
    ],
    phoneField: 'phone',
    emailField: 'email',
    nameField: 'name'
  },
  'magicbricks': {
    name: 'MagicBricks',
    webhookPath: '/webhook/magicbricks',
    secretEnvVar: 'MAGICBRICKS_WEBHOOK_SECRET',
    supportedFields: [
      'name',
      'firstName',
      'lastName',
      'phone',
      'mobileNumber',
      'emailId',
      'propertyType',
      'locality',
      'city',
      'minBudget',
      'maxBudget',
      'buyingTime',
      'buyingPurpose',
      'propertyId'
    ],
    phoneField: 'phone',
    emailField: 'emailId',
    nameField: 'name'
  },
  'housing': {
    name: 'Housing.com',
    webhookPath: '/webhook/housing',
    secretEnvVar: 'HOUSING_COM_WEBHOOK_SECRET',
    supportedFields: [
      'name',
      'userName',
      'phone',
      'mobile',
      'email',
      'type',
      'propertyType',
      'locality',
      'location',
      'area',
      'budget',
      'whenToBuy',
      'purpose',
      'id',
      'propertyId'
    ],
    phoneField: 'phone',
    emailField: 'email',
    nameField: 'name'
  },
  'commonfloor': {
    name: 'CommonFloor',
    webhookPath: '/webhook/commonfloor',
    secretEnvVar: 'COMMONFLOOR_WEBHOOK_SECRET',
    supportedFields: [
      'name',
      'contactName',
      'phone',
      'mobile',
      'phoneNumber',
      'email',
      'propertyType',
      'locality',
      'city',
      'budgetMin',
      'budgetMax',
      'timeline',
      'purpose',
      'propertyId'
    ],
    phoneField: 'phone',
    emailField: 'email',
    nameField: 'name'
  }
};

/**
 * Get portal configuration by name
 */
export function getPortalConfig(name: string): PortalConfig | undefined {
  return portalConfigs[name.toLowerCase()];
}

/**
 * Get all portal configurations
 */
export function getAllPortalConfigs(): Record<string, PortalConfig> {
  return portalConfigs;
}
