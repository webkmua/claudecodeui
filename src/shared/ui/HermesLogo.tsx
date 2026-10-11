type HermesLogoProps = {
  className?: string;
};

/** Rendered by the shared LLMProviderLogo when the provider is Hermes. */
const HermesLogo = ({ className = 'w-5 h-5' }: HermesLogoProps) => (
  <img
    className={`${className} block object-contain`}
    src="/icons/hermes-agent.png"
    alt="Hermes"
    loading="lazy"
  />
);

export default HermesLogo;
