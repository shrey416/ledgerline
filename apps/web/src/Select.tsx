import * as Primitive from '@radix-ui/react-select';
import { Children, isValidElement, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

/** One keyboard-accessible selector for every product surface, including modal forms. */
export function Select({
  value,
  onChange,
  children,
  disabled,
  required,
  name,
  'aria-label': label,
}: {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  'aria-label'?: string;
}) {
  const options = Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{ value?: string | number; children: ReactNode; disabled?: boolean }>(child)
    )
      return [];
    return [
      {
        value: String(child.props.value ?? child.props.children),
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ];
  });
  return (
    <Primitive.Root
      value={String(value)}
      onValueChange={(next) => onChange({ target: { value: next } })}
      disabled={disabled}
      required={required}
      name={name}
    >
      <Primitive.Trigger className="ll-select" aria-label={label}>
        <Primitive.Value />
        <Primitive.Icon>
          <ChevronDown size={16} />
        </Primitive.Icon>
      </Primitive.Trigger>
      {/* No body portal: native modal dialogs put external portals outside the top layer. */}
      <Primitive.Content
        className="ll-select-menu"
        position="popper"
        sideOffset={5}
        collisionPadding={12}
      >
        <Primitive.ScrollUpButton className="ll-select-scroll">
          <ChevronUp size={14} />
        </Primitive.ScrollUpButton>
        <Primitive.Viewport>
          {options.map((option) => (
            <Primitive.Item
              className="ll-select-option"
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              <Primitive.ItemText>{option.label}</Primitive.ItemText>
              <Primitive.ItemIndicator>
                <Check size={15} />
              </Primitive.ItemIndicator>
            </Primitive.Item>
          ))}
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="ll-select-scroll">
          <ChevronDown size={14} />
        </Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Root>
  );
}
